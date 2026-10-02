// Module xác thực: user store, session, chống spam đăng nhập/đăng ký.
// Toàn bộ dùng Node stdlib (crypto/fs) — không thêm dependency.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUTH_DIR = process.env.MQC_AUTH_DIR || path.join(__dirname, '..', 'data', 'auth');
const USERS_FILE = path.join(AUTH_DIR, 'users.json');
const SESSIONS_FILE = path.join(AUTH_DIR, 'sessions.json');
const LOGIN_ATTEMPTS_FILE = path.join(AUTH_DIR, 'login_attempts.json');
const REGISTER_ATTEMPTS_FILE = path.join(AUTH_DIR, 'register_attempts.json');

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 7 * DAY_MS;
const NAME_CHANGE_COOLDOWN_MS = 7 * DAY_MS;
const PASSWORD_CHANGE_COOLDOWN_MS = 7 * DAY_MS;

const LOGIN_FREE_ATTEMPTS = 5;      // 5 lần sai đầu không bị chặn
const LOGIN_BASE_WAIT_MS = 30 * 1000; // lần sai thứ 6: chờ 30s, rồi x2 mỗi lần
const LOGIN_MAX_WAIT_MS = DAY_MS;     // cap thời gian chờ ở 24h
const LOGIN_WINDOW_MS = DAY_MS;       // cửa sổ đếm lỗi reset sau 1 ngày

const REGISTER_LIMIT = 5;             // tối đa 5 tài khoản
const REGISTER_WINDOW_MS = 60 * 60 * 1000; // mỗi giờ / IP

function ensureAuthDirs() {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
  for (const f of [USERS_FILE, SESSIONS_FILE, LOGIN_ATTEMPTS_FILE, REGISTER_ATTEMPTS_FILE]) {
    if (!fs.existsSync(f)) fs.writeFileSync(f, '{}', 'utf8');
  }
  if (!fs.existsSync(USERS_FILE) || fs.readFileSync(USERS_FILE, 'utf8').trim() === '{}') {
    fs.writeFileSync(USERS_FILE, '[]', 'utf8');
  }
}
ensureAuthDirs();

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8') || JSON.stringify(fallback));
  } catch (err) {
    return fallback;
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ── Password hashing (scrypt, stdlib) ──
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, expectedHashHex) {
  const hash = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHashHex, 'hex');
  if (hash.length !== expected.length) return false;
  return crypto.timingSafeEqual(hash, expected);
}

// ── Users ──
function getUsers() { return readJSON(USERS_FILE, []); }
function saveUsers(users) { writeJSON(USERS_FILE, users); }

function findUserByUsername(username) {
  const lower = String(username || '').toLowerCase();
  return getUsers().find(u => u.usernameLower === lower) || null;
}

function validateUsername(username) {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username || '')) {
    return 'Tài khoản phải dài 3-20 ký tự, chỉ gồm chữ, số và gạch dưới.';
  }
  return null;
}
function validateDisplayName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed.length > 30) {
    return 'Tên hiển thị không được để trống và tối đa 30 ký tự.';
  }
  return null;
}
function validatePassword(password) {
  if (!password || password.length < 6) {
    return 'Mật khẩu phải có ít nhất 6 ký tự.';
  }
  return null;
}

function createUser({ username, displayName, password }) {
  const { salt, hash } = hashPassword(password);
  const now = Date.now();
  const user = {
    username,
    usernameLower: username.toLowerCase(),
    displayName: displayName.trim(),
    salt,
    passwordHash: hash,
    createdAt: now,
    lastNameChangeAt: 0,
    lastPasswordChangeAt: 0,
  };
  const users = getUsers();
  users.push(user);
  saveUsers(users);
  return user;
}

function updateUser(username, patch) {
  const users = getUsers();
  const idx = users.findIndex(u => u.usernameLower === String(username).toLowerCase());
  if (idx < 0) return null;
  users[idx] = { ...users[idx], ...patch };
  saveUsers(users);
  return users[idx];
}

function cooldownInfo(lastChangeAt, cooldownMs) {
  const now = Date.now();
  const nextAllowedAt = (lastChangeAt || 0) + cooldownMs;
  if (lastChangeAt && now < nextAllowedAt) {
    return { allowed: false, nextAllowedAt };
  }
  return { allowed: true, nextAllowedAt: 0 };
}

// ── Sessions ──
function getSessions() { return readJSON(SESSIONS_FILE, {}); }
function saveSessions(sessions) { writeJSON(SESSIONS_FILE, sessions); }

function createSession(username) {
  const sessions = getSessions();
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  sessions[token] = { username, createdAt: now, expiresAt: now + SESSION_TTL_MS };
  saveSessions(sessions);
  return token;
}

function getSession(token) {
  if (!token) return null;
  const sessions = getSessions();
  const session = sessions[token];
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    delete sessions[token];
    saveSessions(sessions);
    return null;
  }
  return session;
}

function deleteSession(token) {
  const sessions = getSessions();
  if (sessions[token]) {
    delete sessions[token];
    saveSessions(sessions);
  }
}

function deleteOtherSessions(username, exceptToken) {
  const sessions = getSessions();
  const lower = username.toLowerCase();
  let changed = false;
  for (const token of Object.keys(sessions)) {
    if (token !== exceptToken && sessions[token].username.toLowerCase() === lower) {
      delete sessions[token];
      changed = true;
    }
  }
  if (changed) saveSessions(sessions);
}

// ── Cookie helpers ──
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}
const SESSION_COOKIE = 'mqc_session';
function sessionCookieHeader(token, isSecure) {
  const secureFlag = isSecure ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secureFlag}`;
}
function clearSessionCookieHeader(isSecure) {
  const secureFlag = isSecure ? '; Secure' : '';
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureFlag}`;
}

// ── Chống spam đăng nhập (theo IP) ──
function getLoginAttempts() { return readJSON(LOGIN_ATTEMPTS_FILE, {}); }
function saveLoginAttempts(data) { writeJSON(LOGIN_ATTEMPTS_FILE, data); }

function checkLoginLock(ip) {
  const attempts = getLoginAttempts();
  const entry = attempts[ip];
  if (!entry) return { locked: false };
  const now = Date.now();
  if (now - entry.firstFailAt > LOGIN_WINDOW_MS) return { locked: false }; // cửa sổ đã hết, coi như sạch
  if (entry.lockUntil && now < entry.lockUntil) {
    return { locked: true, waitSeconds: Math.ceil((entry.lockUntil - now) / 1000) };
  }
  return { locked: false };
}

function recordLoginFailure(ip) {
  const attempts = getLoginAttempts();
  const now = Date.now();
  let entry = attempts[ip];
  if (!entry || now - entry.firstFailAt > LOGIN_WINDOW_MS) {
    entry = { count: 0, firstFailAt: now, lockUntil: 0 };
  }
  entry.count += 1;
  let warning = null;
  if (entry.count > LOGIN_FREE_ATTEMPTS) {
    const overBy = entry.count - LOGIN_FREE_ATTEMPTS;
    const waitMs = Math.min(LOGIN_BASE_WAIT_MS * Math.pow(2, overBy - 1), LOGIN_MAX_WAIT_MS);
    entry.lockUntil = now + waitMs;
  } else {
    const remaining = LOGIN_FREE_ATTEMPTS - entry.count;
    if (remaining <= 2) warning = `Sai mật khẩu. Còn ${remaining} lần thử trước khi bị tạm khóa.`;
  }
  attempts[ip] = entry;
  saveLoginAttempts(attempts);
  return {
    locked: !!entry.lockUntil,
    waitSeconds: entry.lockUntil ? Math.ceil((entry.lockUntil - now) / 1000) : 0,
    warning,
  };
}

function recordLoginSuccess(ip) {
  const attempts = getLoginAttempts();
  if (attempts[ip]) {
    delete attempts[ip];
    saveLoginAttempts(attempts);
  }
}

// ── Chống spam đăng ký (theo IP) ──
function getRegisterAttempts() { return readJSON(REGISTER_ATTEMPTS_FILE, {}); }
function saveRegisterAttempts(data) { writeJSON(REGISTER_ATTEMPTS_FILE, data); }

function checkRegisterLimit(ip) {
  const attempts = getRegisterAttempts();
  const now = Date.now();
  const list = (attempts[ip] || []).filter(t => now - t < REGISTER_WINDOW_MS);
  attempts[ip] = list;
  saveRegisterAttempts(attempts);
  if (list.length >= REGISTER_LIMIT) {
    return { allowed: false, retryAt: list[0] + REGISTER_WINDOW_MS };
  }
  return { allowed: true };
}

function recordRegister(ip) {
  const attempts = getRegisterAttempts();
  const now = Date.now();
  const list = (attempts[ip] || []).filter(t => now - t < REGISTER_WINDOW_MS);
  list.push(now);
  attempts[ip] = list;
  saveRegisterAttempts(attempts);
}

module.exports = {
  SESSION_COOKIE,
  NAME_CHANGE_COOLDOWN_MS,
  PASSWORD_CHANGE_COOLDOWN_MS,
  hashPassword,
  verifyPassword,
  findUserByUsername,
  createUser,
  updateUser,
  cooldownInfo,
  validateUsername,
  validateDisplayName,
  validatePassword,
  createSession,
  getSession,
  deleteSession,
  deleteOtherSessions,
  parseCookies,
  sessionCookieHeader,
  clearSessionCookieHeader,
  checkLoginLock,
  recordLoginFailure,
  recordLoginSuccess,
  checkRegisterLimit,
  recordRegister,
};
