const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const auth = require('./auth.js');

const ROOT = path.resolve(__dirname, '..');
const STATIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const PRIVATE_DIR = path.join(DATA_DIR, 'private');
const PUBLIC_DIR = path.join(DATA_DIR, 'public');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const PORT = process.env.PORT || 8080;
const DEFAULT_APP_URL = 'https://mini-quiz-classroom-n12.ai.studio';

// Lấy địa chỉ IP mạng nội bộ (LAN) của máy chủ - ưu tiên card Wi-Fi thật, bỏ qua card VPN ảo
function getServerLanIp() {
  const nets = os.networkInterfaces();
  const candidates = [];
  
  for (const [name, list] of Object.entries(nets)) {
    const lowerName = name.toLowerCase();
    // Bỏ qua các card mạng ảo và VPN
    if (lowerName.includes('virtual') || lowerName.includes('vpn') || lowerName.includes('wireguard') || lowerName.includes('vethernet') || lowerName.includes('radmin') || lowerName.includes('hamachi')) {
      continue;
    }
    for (const net of list) {
      if (net.family === 'IPv4' && !net.internal) {
        // Loại trừ dải mạng ảo VirtualBox
        if (net.address.startsWith('192.168.56.')) continue;
        
        // Ưu tiên cao nhất: Card Wi-Fi hoặc Wireless thật
        if (lowerName.includes('wi-fi') || lowerName.includes('wifi') || lowerName.includes('wlan') || lowerName.includes('wireless')) {
          return net.address;
        }
        candidates.push({ name, ip: net.address });
      }
    }
  }

  // Ưu tiên tiếp theo: mạng LAN gia đình/trường học 192.168.x.x
  const homeNet = candidates.find(c => c.ip.startsWith('192.168.'));
  if (homeNet) return homeNet.ip;

  if (candidates.length > 0) return candidates[0].ip;

  return '127.0.0.1';
}

// Đảm bảo thư mục lưu trữ tồn tại
function ensureStorageDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PRIVATE_DIR)) fs.mkdirSync(PRIVATE_DIR, { recursive: true });
  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });

  const publicFile = path.join(PUBLIC_DIR, 'exams.json');
  if (!fs.existsSync(publicFile)) {
    fs.writeFileSync(publicFile, JSON.stringify([], null, 2), 'utf8');
  }
}
ensureStorageDirs();

// Helper đọc/ghi Lịch sử làm bài cho từng user
function getUserHistoryFile(username) {
  const safeUser = String(username || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
  const userDir = path.join(HISTORY_DIR, `user_${safeUser}`);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  const filePath = path.join(userDir, 'history.json');
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf8');
  }
  return filePath;
}

function readUserHistory(username) {
  try {
    const fp = getUserHistoryFile(username);
    return JSON.parse(fs.readFileSync(fp, 'utf8') || '[]');
  } catch (err) {
    return [];
  }
}

function writeUserHistory(username, historyList) {
  const fp = getUserHistoryFile(username);
  fs.writeFileSync(fp, JSON.stringify(historyList, null, 2), 'utf8');
}

// Helper đọc/ghi Lịch sử phòng thi đã tổ chức (tối đa 20 phòng gần nhất)
function getHostRoomHistoryFile(username) {
  const safeUser = String(username || 'admin').replace(/[^a-zA-Z0-9_-]/g, '_');
  const userDir = path.join(HISTORY_DIR, `user_${safeUser}`);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  const filePath = path.join(userDir, 'hosted_rooms.json');
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf8');
  }
  return filePath;
}

function readHostRoomHistory(username) {
  try {
    const fp = getHostRoomHistoryFile(username);
    return JSON.parse(fs.readFileSync(fp, 'utf8') || '[]');
  } catch (err) {
    return [];
  }
}

function writeHostRoomHistory(username, list) {
  const fp = getHostRoomHistoryFile(username);
  fs.writeFileSync(fp, JSON.stringify(list, null, 2), 'utf8');
}

function calculateRoomExamStats(room) {
  const candidates = (room.players || []).filter(p => !p.isHost);
  const totalQuestions = (room.questions || []).length;
  const maxPossibleScore = totalQuestions * 100;
  const scores = candidates.map(c => Number(c.score) || 0);
  const avgScore = candidates.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / candidates.length) : 0;
  const maxScore = candidates.length > 0 ? Math.max(...scores) : 0;
  const topCandidate = candidates.find(c => (Number(c.score) || 0) === maxScore);

  const questionsStats = (room.questions || []).map((q, qIdx) => {
    const answersForQ = (room.answers && room.answers[qIdx]) || {};
    const countedIds = new Set();
    let correctCount = 0;
    Object.values(answersForQ).forEach(ans => {
      const idKey = ans.playerId || ans.nick;
      if (idKey && !countedIds.has(idKey)) {
        countedIds.add(idKey);
        if (ans.isCorrect) correctCount++;
      }
    });
    const totalCount = candidates.length;
    const ratioPct = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
    return {
      qIdx: qIdx + 1,
      text: q.text || ('Câu ' + (qIdx + 1)),
      correctIndex: q.correct,
      correctText: (q.choices && q.choices[q.correct] !== undefined) ? q.choices[q.correct] : '',
      correctCount,
      totalCount,
      ratioPct
    };
  });

  const candidatesMatrix = candidates.map(c => {
    const answersMap = [];
    let correctCount = 0;
    for (let qIdx = 0; qIdx < totalQuestions; qIdx++) {
      const ans = room.answers && room.answers[qIdx] && (room.answers[qIdx][c.id] || room.answers[qIdx][c.nick]);
      const isCorrect = ans ? !!ans.isCorrect : false;
      if (isCorrect) correctCount++;
      answersMap.push(isCorrect);
    }
    const ratioPct = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
    return {
      id: c.id,
      nick: c.nick,
      av: c.av || '01',
      score: Number(c.score) || 0,
      answersMap,
      correctCount,
      totalQuestions,
      ratioPct
    };
  });

  candidatesMatrix.sort((a, b) => (b.ratioPct - a.ratioPct) || (b.score - a.score));

  return {
    totalCandidates: candidates.length,
    capacity: Number(room.capacity) || 40,
    avgScore,
    maxScore,
    maxPossibleScore,
    topCandidateNick: topCandidate ? topCandidate.nick : '',
    questionsStats,
    candidatesMatrix
  };
}

function archiveHostedRoom(username, room, stats) {
  const hostUser = username || 'admin';
  const list = readHostRoomHistory(hostUser);
  const existingIdx = list.findIndex(r => r.pin === room.pin);
  const now = room.finishedAt || Date.now();
  const record = {
    id: 'hosted-' + now,
    pin: room.pin,
    roomTitle: room.name || room.title || 'Phòng thi trực tuyến',
    createdAt: room.createdAt || now,
    finishedAt: now,
    formattedTime: new Date(now).toLocaleDateString('vi-VN', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    }),
    stats
  };

  if (existingIdx >= 0) {
    list[existingIdx] = record;
  } else {
    list.unshift(record);
  }
  // Giới hạn lưu đúng 20 phòng tổ chức gần nhất
  if (list.length > 20) {
    list.length = 20;
  }
  writeHostRoomHistory(hostUser, list);
}

// Helper đọc/ghi Private Storage cho từng user
function getUserPrivateFile(username) {
  const safeUser = String(username || '0').replace(/[^a-zA-Z0-9_-]/g, '_');
  const userDir = path.join(PRIVATE_DIR, `user_${safeUser}`);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  const filePath = path.join(userDir, 'exams.json');
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf8');
  }
  return filePath;
}

function readPrivateExams(username) {
  try {
    const fp = getUserPrivateFile(username);
    return JSON.parse(fs.readFileSync(fp, 'utf8') || '[]');
  } catch (err) {
    return [];
  }
}

function writePrivateExams(username, exams) {
  const fp = getUserPrivateFile(username);
  fs.writeFileSync(fp, JSON.stringify(exams, null, 2), 'utf8');
}

// Helper đọc/ghi Public Storage
function getPublicExamsFile() {
  return path.join(PUBLIC_DIR, 'exams.json');
}

function readPublicExams() {
  try {
    const fp = getPublicExamsFile();
    return JSON.parse(fs.readFileSync(fp, 'utf8') || '[]');
  } catch (err) {
    return [];
  }
}

function writePublicExams(exams) {
  const fp = getPublicExamsFile();
  fs.writeFileSync(fp, JSON.stringify(exams, null, 2), 'utf8');
}

function sortExamsByCode(exams) {
  return (exams || []).slice().sort((a, b) => {
    const codeA = String(a.code || '').trim();
    const codeB = String(b.code || '').trim();
    return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function canonicalizeQuestion(q) {
  if (!q) return '';
  const text = String(q.text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const choices = (q.choices || []).map(c => String(c || '').trim().toLowerCase().replace(/\s+/g, ' '));
  const correctText = choices[q.correct] || '';
  const sortedChoices = [...choices].sort().join('|');
  return `q:${text}#c:${correctText}#ch:${sortedChoices}`;
}

function getCanonicalExamString(exam) {
  if (!exam) return '';
  const title = String(exam.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const canonicalQuestions = (exam.questions || []).map(canonicalizeQuestion).sort();
  return `title:${title}\nquestions:\n${canonicalQuestions.join('\n')}`;
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const v0 = new Int32Array(b.length + 1);
  const v1 = new Int32Array(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = (a[i] === b[j]) ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v0[b.length];
}

function calculateExamDiffPercent(parentExam, currentExam) {
  const s1 = getCanonicalExamString(parentExam);
  const s2 = getCanonicalExamString(currentExam);
  if (s1 === s2) return 0;
  const dist = levenshteinDistance(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  return maxLen > 0 ? (dist / maxLen) * 100 : 0;
}

// MIME types cho file tĩnh
const MIME = {
  '.html': 'text/html;charset=utf-8',
  '.css':  'text/css;charset=utf-8',
  '.js':   'application/javascript;charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.json': 'application/json;charset=utf-8',
};

// Đọc JSON body từ request
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 2e6) { // 2MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Bộ nhớ đệm các phòng thi đang mở & đồng bộ bền vững xuống đĩa
const activeRooms = new Map();
const roomCleanupTimers = new Map(); // Quản lý timer dọn dẹp phòng thi riêng biệt tránh circular JSON
const ROOM_HOLD_MS = 24 * 60 * 60 * 1000;          // 24 giờ: giữ chỗ trong danh sách
const ROOM_EXPIRE_MS = (24 * 60 + 15) * 60 * 1000; // 24 giờ 15 phút: hủy bỏ phòng

const ACTIVE_ROOMS_FILE = path.join(DATA_DIR, 'active_rooms.json');
const ACTIVE_ROOMS_TMP_FILE = path.join(DATA_DIR, 'active_rooms.json.tmp');

let saveRoomsTimer = null;
function saveActiveRooms(debounce = false) {
  if (debounce) {
    if (saveRoomsTimer) clearTimeout(saveRoomsTimer);
    saveRoomsTimer = setTimeout(() => {
      saveRoomsTimer = null;
      writeActiveRoomsToDisk();
    }, 200);
    return;
  }
  if (saveRoomsTimer) {
    clearTimeout(saveRoomsTimer);
    saveRoomsTimer = null;
  }
  writeActiveRoomsToDisk();
}

function writeActiveRoomsToDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const list = Array.from(activeRooms.entries());
    fs.writeFileSync(ACTIVE_ROOMS_TMP_FILE, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(ACTIVE_ROOMS_TMP_FILE, ACTIVE_ROOMS_FILE);
  } catch (err) {
    console.error('Lỗi lưu trữ active rooms xuống đĩa:', err.message);
  }
}

function loadActiveRooms() {
  if (!fs.existsSync(ACTIVE_ROOMS_FILE)) return;
  try {
    const raw = fs.readFileSync(ACTIVE_ROOMS_FILE, 'utf8');
    if (!raw.trim()) return;
    const entries = JSON.parse(raw);
    const now = Date.now();
    let changed = false;

    for (const [pin, room] of entries) {
      if (!pin || !room) continue;

      // 1. Kiểm tra hạn phòng 24h15m dựa trên createdAt tuyệt đối
      if (room.createdAt && (now - room.createdAt > ROOM_EXPIRE_MS)) {
        changed = true;
        continue;
      }

      // 2. Phòng đã kết thúc: 3 phút grace period
      if (room.status === 'finished') {
        const finishedAt = room.finishedAt || room.createdAt || now;
        const elapsed = now - finishedAt;
        const remainingGrace = (3 * 60 * 1000) - elapsed;
        if (remainingGrace <= 0) {
          changed = true;
          continue;
        }
        if (roomCleanupTimers.has(pin)) clearTimeout(roomCleanupTimers.get(pin));
        roomCleanupTimers.set(pin, setTimeout(() => {
          activeRooms.delete(pin);
          roomCleanupTimers.delete(pin);
          saveActiveRooms();
        }, remainingGrace));
      }

      // 3. Phòng đang trong giai đoạn đếm ngược (countdown 5s)
      if (room.status === 'countdown' && room.countdownEnd && now >= room.countdownEnd) {
        room.status = 'started';
        changed = true;
      }

      activeRooms.set(pin, room);
    }

    if (changed) {
      saveActiveRooms();
    }
  } catch (err) {
    console.error('Lỗi nạp active rooms từ đĩa:', err.message);
  }
}

// Nạp lại danh sách phòng đang hoạt động khi server khởi động
loadActiveRooms();

// Tự động dọn dẹp phòng thi hết hạn hoặc phòng đã tổ chức xong quá 3 phút
function cleanupExpiredRooms() {
  const now = Date.now();
  let changed = false;
  for (const [pin, room] of activeRooms.entries()) {
    // Phòng đã tổ chức xong quá 3 phút -> Xóa giải phóng PIN
    if (room.status === 'finished' && room.finishedAt && (now - room.finishedAt > 3 * 60 * 1000)) {
      activeRooms.delete(pin);
      changed = true;
      continue;
    }
    // Phòng hết hạn > 24h15m
    if (room.createdAt && (now - room.createdAt > ROOM_EXPIRE_MS)) {
      activeRooms.delete(pin);
      changed = true;
    }
  }
  if (changed) {
    saveActiveRooms();
  }
}
setInterval(cleanupExpiredRooms, 30 * 1000); // kiểm tra dọn dẹp mỗi 30 giây

// Lấy IP client (dùng cho chống spam đăng nhập/đăng ký)
// Hỗ trợ Cloudflare, Reverse Proxy (Nginx/Caddy/ngrok) và kết nối trực tiếp
function getClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp && typeof cfIp === 'string') return cfIp.trim();

  const xff = req.headers['x-forwarded-for'];
  if (xff && typeof xff === 'string') {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }

  const realIp = req.headers['x-real-ip'];
  if (realIp && typeof realIp === 'string') return realIp.trim();

  let ip = req.socket.remoteAddress || 'unknown';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

// Xác định giao thức (HTTP / HTTPS) và host công khai
function getRequestProto(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (forwardedProto && typeof forwardedProto === 'string') {
    return forwardedProto.split(',')[0].trim();
  }
  return req.socket.encrypted ? 'https' : 'http';
}

function getRequestHost(req) {
  return req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
}

// Lấy user đang đăng nhập từ cookie session; null nếu không hợp lệ
function getSessionUser(req) {
  const cookies = auth.parseCookies(req.headers.cookie);
  const token = cookies[auth.SESSION_COOKIE];
  const session = auth.getSession(token);
  return session ? { username: session.username, token } : null;
}

function sendJSON(res, status, obj, extraHeaders) {
  res.writeHead(status, { 'Content-Type': 'application/json;charset=utf-8', ...(extraHeaders || {}) });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const proto = getRequestProto(req);
  const host = getRequestHost(req);
  const isSecure = proto === 'https';
  const parsedUrl = new URL(req.url, `${proto}://${host}`);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // CORS headers: hỗ trợ credentials cho cả Internet và LAN
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ══════════════════════════════════════════════════════════
  // AUTH ENDPOINTS
  // ══════════════════════════════════════════════════════════

  // [GET] /api/auth/check-username - Kiểm tra tài khoản tồn tại thời gian thực
  if (method === 'GET' && pathname === '/api/auth/check-username') {
    const u = (parsedUrl.searchParams.get('u') || '').trim();
    if (!u) {
      sendJSON(res, 400, { exists: false, valid: false, message: 'Tài khoản không được rỗng.' });
      return;
    }
    const err = auth.validateUsername(u);
    if (err) {
      sendJSON(res, 200, { exists: false, valid: false, message: err });
      return;
    }
    const exists = !!auth.findUserByUsername(u);
    sendJSON(res, 200, {
      exists,
      valid: !exists,
      message: exists ? 'Tài khoản này đã được sử dụng!' : 'Tài khoản hợp lệ và có thể đăng ký.'
    });
    return;
  }

  // [POST] /api/auth/register
  if (method === 'POST' && pathname === '/api/auth/register') {
    try {
      const ip = getClientIp(req);
      const limit = auth.checkRegisterLimit(ip);
      if (!limit.allowed) {
        const waitMin = Math.ceil((limit.retryAt - Date.now()) / 60000);
        sendJSON(res, 429, { success: false, message: `Đã đăng ký quá nhiều lần từ mạng này. Vui lòng thử lại sau khoảng ${waitMin} phút.` });
        return;
      }

      const body = await readJsonBody(req);
      const { username, displayName, password, confirmPassword } = body;

      const usernameErr = auth.validateUsername(username);
      if (usernameErr) { sendJSON(res, 400, { success: false, message: usernameErr }); return; }
      const nameErr = auth.validateDisplayName(displayName);
      if (nameErr) { sendJSON(res, 400, { success: false, message: nameErr }); return; }
      const passErr = auth.validatePassword(password);
      if (passErr) { sendJSON(res, 400, { success: false, message: passErr }); return; }
      if (password !== confirmPassword) {
        sendJSON(res, 400, { success: false, message: 'Xác nhận mật khẩu không khớp.' });
        return;
      }
      if (auth.findUserByUsername(username)) {
        sendJSON(res, 409, { success: false, message: 'Tài khoản đã tồn tại.' });
        return;
      }

      auth.createUser({ username, displayName, password });
      auth.recordRegister(ip);
      const token = auth.createSession(username);
      sendJSON(res, 200, { success: true, username, displayName: displayName.trim() }, { 'Set-Cookie': auth.sessionCookieHeader(token, isSecure) });
      return;
    } catch (err) {
      sendJSON(res, 500, { success: false, message: err.message });
      return;
    }
  }

  // [POST] /api/auth/login
  if (method === 'POST' && pathname === '/api/auth/login') {
    try {
      const ip = getClientIp(req);
      const lock = auth.checkLoginLock(ip);
      if (lock.locked) {
        sendJSON(res, 429, { success: false, message: `Bạn đã đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${lock.waitSeconds} giây.` });
        return;
      }

      const body = await readJsonBody(req);
      const { username, password } = body;
      const user = auth.findUserByUsername(username);
      const ok = user && auth.verifyPassword(password || '', user.salt, user.passwordHash);

      if (!ok) {
        const result = auth.recordLoginFailure(ip);
        if (result.locked) {
          sendJSON(res, 429, { success: false, message: `Sai tài khoản hoặc mật khẩu. Bạn bị tạm khóa đăng nhập trong ${result.waitSeconds} giây.` });
        } else {
          sendJSON(res, 401, { success: false, message: result.warning || 'Tài khoản hoặc mật khẩu không đúng.' });
        }
        return;
      }

      auth.recordLoginSuccess(ip);
      const token = auth.createSession(user.username);
      sendJSON(res, 200, { success: true, username: user.username, displayName: user.displayName }, { 'Set-Cookie': auth.sessionCookieHeader(token, isSecure) });
      return;
    } catch (err) {
      sendJSON(res, 500, { success: false, message: err.message });
      return;
    }
  }

  // [POST] /api/auth/logout
  if (method === 'POST' && pathname === '/api/auth/logout') {
    const cookies = auth.parseCookies(req.headers.cookie);
    const token = cookies[auth.SESSION_COOKIE];
    if (token) auth.deleteSession(token);
    sendJSON(res, 200, { success: true }, { 'Set-Cookie': auth.clearSessionCookieHeader(isSecure) });
    return;
  }

  // [GET] /api/auth/me
  if (method === 'GET' && pathname === '/api/auth/me') {
    const sessionUser = getSessionUser(req);
    if (!sessionUser) { sendJSON(res, 401, { success: false, message: 'Chưa đăng nhập.' }); return; }
    const user = auth.findUserByUsername(sessionUser.username);
    if (!user) { sendJSON(res, 401, { success: false, message: 'Chưa đăng nhập.' }); return; }
    sendJSON(res, 200, { success: true, username: user.username, displayName: user.displayName });
    return;
  }

  // [POST] /api/auth/change-profile - đổi tên hiển thị và/hoặc mật khẩu (giới hạn 1 lần/7 ngày mỗi loại)
  if (method === 'POST' && pathname === '/api/auth/change-profile') {
    try {
      const sessionUser = getSessionUser(req);
      if (!sessionUser) { sendJSON(res, 401, { success: false, message: 'Chưa đăng nhập.' }); return; }
      const user = auth.findUserByUsername(sessionUser.username);
      if (!user) { sendJSON(res, 401, { success: false, message: 'Chưa đăng nhập.' }); return; }

      const body = await readJsonBody(req);
      const { currentPassword, newDisplayName, newPassword, confirmNewPassword } = body;

      if (!auth.verifyPassword(currentPassword || '', user.salt, user.passwordHash)) {
        sendJSON(res, 401, { success: false, message: 'Mật khẩu hiện tại không đúng.' });
        return;
      }

      const patch = {};
      const changes = {};

      if (newDisplayName !== undefined && newDisplayName !== null && String(newDisplayName).trim() !== '') {
        const cd = auth.cooldownInfo(user.lastNameChangeAt, auth.NAME_CHANGE_COOLDOWN_MS);
        if (!cd.allowed) {
          sendJSON(res, 429, { success: false, message: `Bạn chỉ được đổi tên hiển thị 1 lần / 7 ngày. Có thể đổi lại vào ${new Date(cd.nextAllowedAt).toLocaleString('vi-VN')}.` });
          return;
        }
        const nameErr = auth.validateDisplayName(newDisplayName);
        if (nameErr) { sendJSON(res, 400, { success: false, message: nameErr }); return; }
        patch.displayName = String(newDisplayName).trim();
        patch.lastNameChangeAt = Date.now();
        changes.displayName = true;
      }

      if (newPassword) {
        const cd = auth.cooldownInfo(user.lastPasswordChangeAt, auth.PASSWORD_CHANGE_COOLDOWN_MS);
        if (!cd.allowed) {
          sendJSON(res, 429, { success: false, message: `Bạn chỉ được đổi mật khẩu 1 lần / 7 ngày. Có thể đổi lại vào ${new Date(cd.nextAllowedAt).toLocaleString('vi-VN')}.` });
          return;
        }
        const passErr = auth.validatePassword(newPassword);
        if (passErr) { sendJSON(res, 400, { success: false, message: passErr }); return; }
        if (newPassword !== confirmNewPassword) {
          sendJSON(res, 400, { success: false, message: 'Xác nhận mật khẩu mới không khớp.' });
          return;
        }
        const { salt, hash } = auth.hashPassword(newPassword);
        patch.salt = salt;
        patch.passwordHash = hash;
        patch.lastPasswordChangeAt = Date.now();
        changes.password = true;
      }

      if (!changes.displayName && !changes.password) {
        sendJSON(res, 400, { success: false, message: 'Không có thay đổi nào được gửi lên.' });
        return;
      }

      const updated = auth.updateUser(user.username, patch);
      if (changes.password) {
        // Đổi mật khẩu thành công -> huỷ session ở các thiết bị khác, giữ session hiện tại.
        auth.deleteOtherSessions(user.username, sessionUser.token);
      }
      sendJSON(res, 200, { success: true, username: updated.username, displayName: updated.displayName });
      return;
    } catch (err) {
      sendJSON(res, 500, { success: false, message: err.message });
      return;
    }
  }

  // ══════════════════════════════════════════════════════════
  // HISTORY ENDPOINTS
  // ══════════════════════════════════════════════════════════

  // [GET] /api/history - Lấy danh sách lịch sử thi của user
  if (method === 'GET' && pathname === '/api/history') {
    const sessionUser = getSessionUser(req);
    if (!sessionUser) {
      sendJSON(res, 401, { success: false, message: 'Chưa đăng nhập.' });
      return;
    }
    const historyList = readUserHistory(sessionUser.username);
    sendJSON(res, 200, { success: true, history: historyList });
    return;
  }

  // [POST] /api/history - Ghi lại kết quả bài thi sau khi hoàn thành
  if (method === 'POST' && pathname === '/api/history') {
    try {
      const sessionUser = getSessionUser(req);
      if (!sessionUser) {
        // Khách vãng lai thi không lưu vào tài khoản
        sendJSON(res, 200, { success: false, guest: true, message: 'Khách thi tự do, không lưu lịch sử.' });
        return;
      }

      const body = await readJsonBody(req);
      const record = {
        id: 'hist-' + Date.now(),
        pin: body.pin || '---',
        roomTitle: body.roomTitle || 'Bài thi Mini Quiz',
        score: Number(body.score) || 0,
        maxScore: Number(body.maxScore) || 0,
        correctCount: Number(body.correctCount) || 0,
        totalQuestions: Number(body.totalQuestions) || 0,
        rank: Number(body.rank) || 1,
        totalPlayers: Number(body.totalPlayers) || 1,
        accuracyPct: Number(body.accuracyPct) || 0,
        finishedAt: Date.now(),
        details: Array.isArray(body.details) ? body.details : []
      };

      const historyList = readUserHistory(sessionUser.username);
      historyList.unshift(record);
      // Giới hạn lưu tối đa 20 bài gần nhất, nếu quá 20 bài thì cắt bớt những bài cũ hơn
      if (historyList.length > 20) {
        historyList.length = 20;
      }
      writeUserHistory(sessionUser.username, historyList);

      sendJSON(res, 200, { success: true, record });
      return;
    } catch (err) {
      sendJSON(res, 500, { success: false, message: err.message });
      return;
    }
  }

  // [GET] /api/history/hosted - Lấy danh sách 20 phòng thi đã tổ chức gần nhất của chủ phòng
  if (method === 'GET' && pathname === '/api/history/hosted') {
    const sessionUser = getSessionUser(req);
    const username = sessionUser ? sessionUser.username : 'admin';
    let list = readHostRoomHistory(username);
    if (list.length === 0 && username !== 'admin') {
      list = readHostRoomHistory('admin');
    }
    if (list.length > 20) list = list.slice(0, 20);
    sendJSON(res, 200, { success: true, hostedRooms: list });
    return;
  }

  // [POST] /api/history/hosted - Lưu phòng thi đã tổ chức vào danh sách lịch sử
  if (method === 'POST' && pathname === '/api/history/hosted') {
    try {
      const sessionUser = getSessionUser(req);
      const username = sessionUser ? sessionUser.username : 'admin';
      const body = await readJsonBody(req);
      if (body && body.pin) {
        archiveHostedRoom(username, body, body.stats);
      }
      sendJSON(res, 200, { success: true });
      return;
    } catch (err) {
      sendJSON(res, 500, { success: false, message: err.message });
      return;
    }
  }

  // ══════════════════════════════════════════════════════════
  // REST API ENDPOINTS
  // ══════════════════════════════════════════════════════════

  // 1. [GET] /api/storage/private - Lấy danh sách đề trong Private Storage của user đang đăng nhập
  if (method === 'GET' && pathname === '/api/storage/private') {
    const sessionUser = getSessionUser(req);
    if (!sessionUser) { sendJSON(res, 401, { success: false, message: 'Chưa đăng nhập.' }); return; }
    const exams = readPrivateExams(sessionUser.username);
    res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
    res.end(JSON.stringify({ success: true, user: sessionUser.username, exams }));
    return;
  }

  // 2. [POST] /api/storage/private - Lưu hoặc cập nhật đề thi trong Private Storage của user đang đăng nhập
  if (method === 'POST' && pathname === '/api/storage/private') {
    try {
      const sessionUser = getSessionUser(req);
      if (!sessionUser) { sendJSON(res, 401, { success: false, message: 'Chưa đăng nhập.' }); return; }
      const body = await readJsonBody(req);
      const user = sessionUser.username;
      const exam = body.exam;

      if (!exam || !exam.title || !Array.isArray(exam.questions)) {
        res.writeHead(400, { 'Content-Type': 'application/json;charset=utf-8' });
        res.end(JSON.stringify({ success: false, message: 'Dữ liệu đề thi không hợp lệ!' }));
        return;
      }

      delete exam.pin; // Không gán sẵn PIN
      if (!exam.code) {
        const hex = Math.random().toString(16).substring(2, 6);
        exam.code = '#' + hex;
      }
      if (!exam.id) {
        exam.id = 'exam-' + Date.now();
      }

      let exams = readPrivateExams(user);
      const idx = exams.findIndex(e => e.id === exam.id);
      if (idx >= 0) {
        exams[idx] = exam;
      } else {
        exams.unshift(exam);
      }
      writePrivateExams(user, exams);

      res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
      res.end(JSON.stringify({ success: true, exam, total: exams.length }));
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json;charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: err.message }));
      return;
    }
  }

  // 3. [DELETE] /api/storage/private/:id - Xóa đề thi khỏi Private Storage của user đang đăng nhập
  if (method === 'DELETE' && pathname.startsWith('/api/storage/private/')) {
    const sessionUser = getSessionUser(req);
    if (!sessionUser) { sendJSON(res, 401, { success: false, message: 'Chưa đăng nhập.' }); return; }
    const examId = pathname.replace('/api/storage/private/', '');
    const user = sessionUser.username;
    let exams = readPrivateExams(user);
    const prevLen = exams.length;
    exams = exams.filter(e => e.id !== examId);
    writePrivateExams(user, exams);

    res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
    res.end(JSON.stringify({ success: true, deleted: prevLen > exams.length }));
    return;
  }

  // 4. [GET] /api/storage/public - Lấy danh sách đề thi dùng chung trong Public Storage
  if (method === 'GET' && pathname === '/api/storage/public') {
    let exams = sortExamsByCode(readPublicExams());
    const q = (parsedUrl.searchParams.get('q') || '').toLowerCase().trim();
    if (q) {
      const cleanQ = q.startsWith('#') ? q.substring(1) : q;
      exams = exams.filter(e => {
        const subj = (e.subject || '').toLowerCase();
        const title = (e.title || '').toLowerCase();
        const code = (e.code || '').toLowerCase();
        const cleanCode = code.startsWith('#') ? code.substring(1) : code;
        const matchCode = code.includes(q) || (cleanQ && cleanCode.includes(cleanQ));
        return subj.includes(q) || title.includes(q) || matchCode;
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
    res.end(JSON.stringify({ success: true, exams }));
    return;
  }

  // 5. [POST] /api/storage/public/share - Chia sẻ đề thi cá nhân lên Public Storage
  if (method === 'POST' && pathname === '/api/storage/public/share') {
    try {
      const sessionUser = getSessionUser(req);
      if (!sessionUser) { sendJSON(res, 401, { success: false, message: 'Chưa đăng nhập.' }); return; }
      const body = await readJsonBody(req);
      const user = sessionUser.username;
      const exam = body.exam;

      if (!exam || !exam.title || !Array.isArray(exam.questions)) {
        res.writeHead(400, { 'Content-Type': 'application/json;charset=utf-8' });
        res.end(JSON.stringify({ success: false, message: 'Dữ liệu đề thi không hợp lệ!' }));
        return;
      }

      let publicExams = readPublicExams();

      // Kiểm tra đề có hậu tố -N (được tải xuống từ ngân hàng)
      const examCode = String(exam.code || '').trim();
      const lastDashIdx = examCode.lastIndexOf('-');
      if (lastDashIdx !== -1) {
        const parentCode = examCode.substring(0, lastDashIdx);
        const parentExam = publicExams.find(e => e.code === parentCode);
        if (parentExam) {
          const diffPercent = calculateExamDiffPercent(parentExam, exam);
          if (diffPercent < 10) {
            sendJSON(res, 400, {
              success: false,
              message: `Đề thi này là bản sao của "${parentExam.title}" (${parentCode}). Bạn cần chỉnh sửa nội dung khác biệt ít nhất 10% so với bản gốc mới có thể chia sẻ lên Ngân hàng!`
            });
            return;
          }
        }
      }

      const sharedExam = JSON.parse(JSON.stringify(exam));
      delete sharedExam.pin;
      sharedExam.sharedBy = user;
      const userRecord = auth.findUserByUsername(sessionUser.username);
      sharedExam.author = (userRecord && userRecord.displayName) ? userRecord.displayName : (exam.author || user);
      if (exam.desc !== undefined) {
        sharedExam.desc = String(exam.desc).trim();
      }
      sharedExam.sharedAt = new Date().toLocaleDateString('vi-VN');

      // Cập nhật nếu đã có cùng id, hoặc thêm mới
      const idx = publicExams.findIndex(e => e.id === sharedExam.id || (e.code && e.code === sharedExam.code));
      if (idx >= 0) {
        publicExams[idx] = sharedExam;
      } else {
        publicExams.unshift(sharedExam);
      }
      writePublicExams(publicExams);

      res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
      res.end(JSON.stringify({ success: true, exam: sharedExam }));
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json;charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: err.message }));
      return;
    }
  }

  // [DELETE] /api/storage/public/:id - Gỡ đề thi khỏi Public Storage
  if (method === 'DELETE' && pathname.startsWith('/api/storage/public/')) {
    try {
      const sessionUser = getSessionUser(req);
      if (!sessionUser) { sendJSON(res, 401, { success: false, message: 'Chưa đăng nhập.' }); return; }
      const examId = pathname.replace('/api/storage/public/', '');
      let publicExams = readPublicExams();
      const targetExam = publicExams.find(e => e.id === examId || e.code === examId);
      if (!targetExam) {
        sendJSON(res, 404, { success: false, message: 'Đề thi không tồn tại trong ngân hàng!' });
        return;
      }

      // Chỉ cho phép người đã chia sẻ hoặc admin gỡ đề
      const sharedBy = (targetExam.sharedBy || '').toLowerCase();
      const currentUser = sessionUser.username.toLowerCase();
      if (sharedBy && sharedBy !== currentUser && currentUser !== 'admin') {
        sendJSON(res, 403, { success: false, message: 'Bạn không có quyền gỡ đề thi này!' });
        return;
      }

      publicExams = publicExams.filter(e => e.id !== targetExam.id && (!targetExam.code || e.code !== targetExam.code));
      writePublicExams(publicExams);
      sendJSON(res, 200, { success: true, message: 'Đã gỡ đề thi khỏi ngân hàng thành công!' });
      return;
    } catch (err) {
      sendJSON(res, 500, { success: false, message: err.message });
      return;
    }
  }

  // 6. [POST] /api/storage/public/save-to-private - Lưu đề từ Public Storage vào Private Storage của user
  if (method === 'POST' && pathname === '/api/storage/public/save-to-private') {
    try {
      const sessionUser = getSessionUser(req);
      if (!sessionUser) { sendJSON(res, 401, { success: false, message: 'Chưa đăng nhập.' }); return; }
      const body = await readJsonBody(req);
      const user = sessionUser.username;
      const publicExamId = body.examId;

      const publicExams = readPublicExams();
      const targetExam = publicExams.find(e => e.id === publicExamId || e.code === publicExamId);

      if (!targetExam) {
        res.writeHead(404, { 'Content-Type': 'application/json;charset=utf-8' });
        res.end(JSON.stringify({ success: false, message: 'Không tìm thấy đề thi trong Public Storage!' }));
        return;
      }

      // Cập nhật số bản sao đã phát hành của đề trên ngân hàng
      targetExam.copiesIssued = (targetExam.copiesIssued || 0) + 1;
      writePublicExams(publicExams);

      // Tạo bản sao lưu vào private storage của user
      const cloned = JSON.parse(JSON.stringify(targetExam));
      cloned.id = 'exam-' + Date.now();
      cloned.code = `${targetExam.code}-${targetExam.copiesIssued}`;
      cloned.parentCode = targetExam.code;
      cloned.createdAt = new Date().toLocaleDateString('vi-VN');
      delete cloned.pin;
      delete cloned.copiesIssued;

      let privateExams = readPrivateExams(user);
      privateExams.unshift(cloned);
      writePrivateExams(user, privateExams);

      res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
      res.end(JSON.stringify({ success: true, exam: cloned }));
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json;charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: err.message }));
      return;
    }
  }

  // 7. [POST] /api/rooms - Đăng ký phòng thi hoạt động
  if (method === 'POST' && pathname === '/api/rooms') {
    try {
      const body = await readJsonBody(req);
      if (!body.pin || !body.questions) {
        res.writeHead(400, { 'Content-Type': 'application/json;charset=utf-8' });
        res.end(JSON.stringify({ success: false, message: 'Thiếu thông tin phòng thi!' }));
        return;
      }
      const sessionUser = getSessionUser(req);
      body.hostUser = (sessionUser && sessionUser.username) || body.hostUser || 'admin';
      body.createdAt = body.createdAt || Date.now();
      body.capacity = Number(body.capacity) || 40;
      body.isLocked = !!body.isLocked;
      body.players = body.players || [];
      activeRooms.set(body.pin, body);
      saveActiveRooms();
      res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
      res.end(JSON.stringify({ success: true, room: body }));
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json;charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: err.message }));
      return;
    }
  }

  // 8. [GET] /api/rooms/:pin - Lấy dữ liệu phòng thi theo mã PIN
  if (method === 'GET' && pathname.startsWith('/api/rooms/')) {
    cleanupExpiredRooms();
    const cleanPath = pathname.replace('/api/rooms/', '');
    const parts = cleanPath.split('/');
    const pin = parts[0];
    const subAction = parts[1] || '';

    const room = activeRooms.get(pin);
    if (!room) {
      res.writeHead(404, { 'Content-Type': 'application/json;charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Phòng thi không tồn tại hoặc đã hết hạn!' }));
      return;
    }

    if (room.createdAt && (Date.now() - room.createdAt > ROOM_EXPIRE_MS)) {
      activeRooms.delete(pin);
      saveActiveRooms();
      res.writeHead(404, { 'Content-Type': 'application/json;charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'Phòng thi đã hết hạn và bị hủy!' }));
      return;
    }

    // Kiểm tra nhanh điều kiện vào phòng (khóa phòng / số lượng người tối đa)
    if (parsedUrl.searchParams.get('check') === '1') {
      if (room.isLocked) {
        sendJSON(res, 200, { success: false, locked: true, message: 'Phòng thi đang khóa, không thể vào' });
        return;
      }
      const currentPlayersCount = (room.players || []).length;
      const maxCap = Number(room.capacity) || 40;
      if (currentPlayersCount >= maxCap) {
        sendJSON(res, 200, { success: false, full: true, message: 'Phòng không còn chỗ trống' });
        return;
      }
      sendJSON(res, 200, { success: true, room });
      return;
    }

    // [GET] /api/rooms/:pin/status - Lấy trạng thái phòng chờ và danh sách người chơi
    if (subAction === 'status') {
      let currentStatus = room.status || 'waiting';
      let remainingSec = 0;
      if (currentStatus === 'countdown') {
        const diffMs = (room.countdownEnd || 0) - Date.now();
        if (diffMs <= 0) {
          room.status = 'started';
          currentStatus = 'started';
        } else {
          remainingSec = Math.max(1, Math.ceil(diffMs / 1000));
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        status: currentStatus,
        countdown: remainingSec,
        title: room.title,
        pin: room.pin,
        isLocked: !!room.isLocked,
        capacity: Number(room.capacity) || 40,
        players: room.players || []
      }));
      return;
    }

    // [GET] /api/rooms/:pin/leaderboard - Lấy bảng xếp hạng điểm thi thời gian thực
    if (subAction === 'leaderboard') {
      const leaderboard = (room.players || [])
        .filter(p => !p.isHost)
        .map(p => ({
          id: p.id,
          nick: p.nick,
          av: p.av || '01',
          score: Number(p.score) || 0,
          currentQ: Number(p.currentQ) || 0,
          lastUpdated: p.lastUpdated || 0
        }))
        .sort((a, b) => (b.score - a.score) || (a.lastUpdated - b.lastUpdated));
      sendJSON(res, 200, { success: true, leaderboard });
      return;
    }

    // [GET] /api/rooms/:pin/question-stats - Thống kê số lượng thí sinh chọn A/B/C/D realtime
    if (subAction === 'question-stats') {
      const q = Number(parsedUrl.searchParams.get('q')) || 0;
      const question = (room.questions && room.questions[q]) || null;
      const choicesLen = (question && Array.isArray(question.choices)) ? question.choices.length : 4;
      const choicesCount = new Array(choicesLen).fill(0);
      const answersForQ = (room.answers && room.answers[q]) || {};

      const countedIds = new Set();
      Object.values(answersForQ).forEach(ans => {
        const idKey = ans.playerId || ans.nick;
        if (idKey && !countedIds.has(idKey)) {
          countedIds.add(idKey);
          if (typeof ans.choice === 'number' && ans.choice >= 0 && ans.choice < choicesLen) {
            choicesCount[ans.choice]++;
          }
        }
      });

      const totalCandidates = (room.players || []).filter(p => !p.isHost).length;
      const allAnswered = totalCandidates > 0 && countedIds.size >= totalCandidates;
      sendJSON(res, 200, {
        success: true,
        q,
        choicesCount,
        totalAnswered: countedIds.size,
        totalCandidates,
        allAnswered
      });
      return;
    }

    // [GET] /api/rooms/:pin/state - Lấy trạng thái câu hỏi và giai đoạn luồng thi lockstep
    if (subAction === 'state') {
      const candidates = (room.players || []).filter(p => !p.isHost);
      const totalCandidates = candidates.length;
      const q = typeof room.currentQ === 'number' ? room.currentQ : 0;
      const currentAnswers = (room.answers && room.answers[q]) || {};
      const countedIds = new Set();
      Object.values(currentAnswers).forEach(ans => {
        const idKey = ans.playerId || ans.nick;
        if (idKey) countedIds.add(idKey);
      });
      const answeredCount = countedIds.size;
      const allAnswered = totalCandidates > 0 && answeredCount >= totalCandidates;

      sendJSON(res, 200, {
        success: true,
        status: room.status || 'waiting',
        currentQ: q,
        phase: room.phase || 'question',
        allAnswered,
        totalAnswered: answeredCount,
        totalCandidates,
        totalQuestions: (room.questions || []).length,
        phaseStartedAt: room.phaseStartedAt || 0
      });
      return;
    }

    // [GET] /api/rooms/:pin/exam-stats - Số liệu thống kê tổng kết đề thi toàn diện
    if (subAction === 'exam-stats') {
      const candidates = (room.players || []).filter(p => !p.isHost);
      const totalQuestions = (room.questions || []).length;
      const maxPossibleScore = totalQuestions * 100;
      const scores = candidates.map(c => Number(c.score) || 0);
      const avgScore = candidates.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / candidates.length) : 0;
      const maxScore = candidates.length > 0 ? Math.max(...scores) : 0;
      const topCandidate = candidates.find(c => (Number(c.score) || 0) === maxScore);

      // 1. Thống kê theo từng câu hỏi (dạng kéo)
      const questionsStats = (room.questions || []).map((q, qIdx) => {
        const answersForQ = (room.answers && room.answers[qIdx]) || {};
        const countedIds = new Set();
        let correctCount = 0;
        Object.values(answersForQ).forEach(ans => {
          const idKey = ans.playerId || ans.nick;
          if (idKey && !countedIds.has(idKey)) {
            countedIds.add(idKey);
            if (ans.isCorrect) correctCount++;
          }
        });
        const totalCount = candidates.length;
        const ratioPct = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
        return {
          qIdx: qIdx + 1,
          text: q.text || ('Câu ' + (qIdx + 1)),
          correctIndex: q.correct,
          correctText: (q.choices && q.choices[q.correct] !== undefined) ? q.choices[q.correct] : '',
          correctCount,
          totalCount,
          ratioPct
        };
      });

      // 2. Ma trận kết quả chi tiết từng thí sinh (kéo dọc và kéo ngang)
      const candidatesMatrix = candidates.map(c => {
        const answersMap = [];
        let correctCount = 0;
        for (let qIdx = 0; qIdx < totalQuestions; qIdx++) {
          const ans = room.answers && room.answers[qIdx] && (room.answers[qIdx][c.id] || room.answers[qIdx][c.nick]);
          const isCorrect = ans ? !!ans.isCorrect : false;
          if (isCorrect) correctCount++;
          answersMap.push(isCorrect);
        }
        const ratioPct = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
        return {
          id: c.id,
          nick: c.nick,
          av: c.av || '01',
          score: Number(c.score) || 0,
          answersMap,
          correctCount,
          totalQuestions,
          ratioPct
        };
      });

      // Sắp xếp ma trận theo điểm số cao nhất lên đầu
      candidatesMatrix.sort((a, b) => b.score - a.score);

      sendJSON(res, 200, {
        success: true,
        stats: {
          totalCandidates: candidates.length,
          capacity: Number(room.capacity) || 40,
          avgScore,
          maxScore,
          maxPossibleScore,
          topCandidateNick: topCandidate ? topCandidate.nick : '',
          questionsStats,
          candidatesMatrix
        }
      });
      return;
    }

    // [GET] /api/rooms/:pin - Lấy thông tin chi tiết phòng
    res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
    res.end(JSON.stringify({ success: true, room }));
    return;
  }

  // 9. [POST] /api/rooms/:pin/leave - Rời khỏi phòng chờ (thu hồi chỗ và cập nhật danh sách)
  if (method === 'POST' && pathname.includes('/leave')) {
    try {
      const match = pathname.match(/^\/api\/rooms\/([^/]+)\/leave$/);
      if (!match) {
        sendJSON(res, 400, { success: false, message: 'Đường dẫn không hợp lệ' });
        return;
      }
      const pin = match[1];
      const room = activeRooms.get(pin);
      if (!room) {
        sendJSON(res, 200, { success: true, message: 'Phòng không tồn tại' });
        return;
      }

      const body = await readJsonBody(req);
      const playerId = body.id || body.playerId;
      const nick = body.nick;

      if (room.players && Array.isArray(room.players)) {
        room.players = room.players.filter(p => {
          if (playerId && p.id === playerId) return false;
          if (!playerId && nick && p.nick === nick) return false;
          return true;
        });
      }
      saveActiveRooms(true);

      sendJSON(res, 200, {
        success: true,
        playersCount: (room.players || []).length,
        players: room.players || []
      });
      return;
    } catch (err) {
      sendJSON(res, 500, { success: false, message: err.message });
      return;
    }
  }

  // 10. [POST] /api/rooms/:pin/join - Tham gia vào phòng chờ
  if (method === 'POST' && pathname.includes('/join')) {
    try {
      const match = pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
      if (!match) {
        sendJSON(res, 400, { success: false, message: 'Đường dẫn không hợp lệ' });
        return;
      }
      const pin = match[1];
      const room = activeRooms.get(pin);
      if (!room) {
        sendJSON(res, 404, { success: false, message: 'Phòng thi không tồn tại hoặc đã hết hạn!' });
        return;
      }

      // Kiểm tra khóa phòng
      if (room.isLocked) {
        sendJSON(res, 403, { success: false, locked: true, message: 'Phòng thi đang khóa, không thể vào' });
        return;
      }

      const body = await readJsonBody(req);
      room.players = room.players || [];

      const playerObj = {
        id: body.id || ('p-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)),
        nick: String(body.nick || 'Khách').trim().slice(0, 25),
        av: String(body.av || '01'),
        isHost: !!body.isHost,
        joinedAt: Date.now()
      };

      const existingIndex = room.players.findIndex(p => p.id === playerObj.id || (p.nick.toLowerCase() === playerObj.nick.toLowerCase() && p.isHost === playerObj.isHost));
      
      // Kiểm tra sức chứa tối đa nếu là người chơi mới
      const maxCapacity = Number(room.capacity) || 40;
      if (existingIndex < 0 && room.players.length >= maxCapacity) {
        sendJSON(res, 403, { success: false, full: true, message: 'Phòng không còn chỗ trống' });
        return;
      }

      if (existingIndex >= 0) {
        room.players[existingIndex] = { ...room.players[existingIndex], ...playerObj };
      } else {
        room.players.push(playerObj);
      }
      saveActiveRooms(true);

      sendJSON(res, 200, {
        success: true,
        player: playerObj,
        status: room.status || 'waiting',
        isLocked: !!room.isLocked,
        capacity: maxCapacity,
        players: room.players,
        title: room.title
      });
      return;
    } catch (err) {
      sendJSON(res, 500, { success: false, message: err.message });
      return;
    }
  }

  // [POST] /api/rooms/:pin/advance - Chủ phòng điều khiển luồng chuyển câu/bảng xếp hạng lockstep
  if (method === 'POST' && pathname.includes('/advance')) {
    try {
      const match = pathname.match(/^\/api\/rooms\/([^/]+)\/advance$/);
      if (!match) {
        sendJSON(res, 400, { success: false, message: 'Đường dẫn không hợp lệ' });
        return;
      }
      const pin = match[1];
      const room = activeRooms.get(pin);
      if (!room) {
        sendJSON(res, 404, { success: false, message: 'Phòng thi không tồn tại hoặc đã hết hạn!' });
        return;
      }

      const body = await readJsonBody(req);
      const action = body.action || 'next-question';
      const now = Date.now();

      if (action === 'set-question') {
        room.currentQ = Number(body.qIdx) || 0;
        room.phase = 'question';
        room.phaseStartedAt = now;
      } else if (action === 'leaderboard') {
        room.phase = 'leaderboard';
        if (typeof body.qIdx === 'number') room.currentQ = body.qIdx;
        room.phaseStartedAt = now;
      } else if (action === 'next-question') {
        const totalQ = (room.questions || []).length;
        const nextQ = (typeof room.currentQ === 'number' ? room.currentQ : 0) + 1;
        if (nextQ < totalQ) {
          room.currentQ = nextQ;
          room.phase = 'question';
        } else {
          room.currentQ = totalQ;
          room.phase = 'finished';
          room.status = 'finished';
          room.isLocked = true; // Giữ nguyên trạng thái khóa
          room.finishedAt = now;

          // Lưu trữ 20 phòng thi đã tổ chức gần nhất
          const stats = calculateRoomExamStats(room);
          const sessionUser = getSessionUser(req);
          const hostUser = (sessionUser && sessionUser.username) || room.hostUser || 'admin';
          archiveHostedRoom(hostUser, room, stats);

          // Khóa trong 3 phút rồi giải phóng mã PIN
          if (roomCleanupTimers.has(pin)) clearTimeout(roomCleanupTimers.get(pin));
          roomCleanupTimers.set(pin, setTimeout(() => {
            activeRooms.delete(pin);
            roomCleanupTimers.delete(pin);
          }, 3 * 60 * 1000));
        }
        room.phaseStartedAt = now;
      } else if (action === 'finish') {
        room.phase = 'finished';
        room.status = 'finished';
        room.isLocked = true; // Giữ nguyên trạng thái khóa
        room.finishedAt = now;

        // Lưu trữ 20 phòng thi đã tổ chức gần nhất
        const stats = calculateRoomExamStats(room);
        const sessionUser = getSessionUser(req);
        const hostUser = (sessionUser && sessionUser.username) || room.hostUser || 'admin';
        archiveHostedRoom(hostUser, room, stats);

        // Khóa trong 3 phút rồi giải phóng mã PIN
        if (roomCleanupTimers.has(pin)) clearTimeout(roomCleanupTimers.get(pin));
        roomCleanupTimers.set(pin, setTimeout(() => {
          activeRooms.delete(pin);
          roomCleanupTimers.delete(pin);
        }, 3 * 60 * 1000));

        room.phaseStartedAt = now;
      }

      saveActiveRooms();

      sendJSON(res, 200, {
        success: true,
        currentQ: room.currentQ,
        phase: room.phase,
        phaseStartedAt: room.phaseStartedAt
      });
      return;
    } catch (err) {
      sendJSON(res, 500, { success: false, message: err.message });
      return;
    }
  }

  // [POST] /api/rooms/:pin/answer - Thí sinh gửi lựa chọn đáp án thời gian thực (để host theo dõi)
  if (method === 'POST' && pathname.includes('/answer')) {
    try {
      const match = pathname.match(/^\/api\/rooms\/([^/]+)\/answer$/);
      if (!match) {
        sendJSON(res, 400, { success: false, message: 'Đường dẫn không hợp lệ' });
        return;
      }
      const pin = match[1];
      const room = activeRooms.get(pin);
      if (!room) {
        sendJSON(res, 404, { success: false, message: 'Phòng thi không tồn tại hoặc đã hết hạn!' });
        return;
      }

      const body = await readJsonBody(req);
      const playerId = body.id || body.playerId;
      const nick = String(body.nick || 'Thí sinh').trim();
      const qIdx = Number(body.qIdx) || 0;
      const choice = Number(body.choice);

      room.answers = room.answers || {};
      room.answers[qIdx] = room.answers[qIdx] || {};

      const question = (room.questions && room.questions[qIdx]) || null;
      const isCorrect = question ? (question.correct === choice) : false;

      const record = {
        playerId,
        nick,
        choice,
        isCorrect,
        answeredAt: Date.now()
      };

      if (playerId) room.answers[qIdx][playerId] = record;
      if (nick) room.answers[qIdx][nick] = record;

      saveActiveRooms(true);

      sendJSON(res, 200, { success: true, qIdx, choice, isCorrect });
      return;
    } catch (err) {
      sendJSON(res, 500, { success: false, message: err.message });
      return;
    }
  }

  // [POST] /api/rooms/:pin/score - Cập nhật điểm thi thời gian thực và trả về BXH
  if (method === 'POST' && pathname.includes('/score')) {
    try {
      const match = pathname.match(/^\/api\/rooms\/([^/]+)\/score$/);
      if (!match) {
        sendJSON(res, 400, { success: false, message: 'Đường dẫn không hợp lệ' });
        return;
      }
      const pin = match[1];
      const room = activeRooms.get(pin);
      if (!room) {
        sendJSON(res, 404, { success: false, message: 'Phòng thi không tồn tại hoặc đã hết hạn!' });
        return;
      }

      const body = await readJsonBody(req);
      const playerId = body.id || body.playerId;
      const nick = String(body.nick || 'Thí sinh').trim().slice(0, 25);
      const av = String(body.av || '01');
      const score = Number(body.score) || 0;
      const currentQ = Number(body.currentQ) || 0;
      const now = Date.now();

      room.players = room.players || [];
      let player = room.players.find(p => (playerId && p.id === playerId) || (p.nick.toLowerCase() === nick.toLowerCase() && !p.isHost));
      if (player) {
        player.score = score;
        player.currentQ = currentQ;
        player.av = av;
        player.lastUpdated = now;
      } else {
        player = {
          id: playerId || ('p-' + now + '-' + Math.random().toString(36).slice(2, 6)),
          nick: nick,
          av: av,
          score: score,
          currentQ: currentQ,
          isHost: false,
          joinedAt: now,
          lastUpdated: now
        };
        room.players.push(player);
      }

      const leaderboard = room.players
        .filter(p => !p.isHost)
        .map(p => ({
          id: p.id,
          nick: p.nick,
          av: p.av || '01',
          score: Number(p.score) || 0,
          currentQ: Number(p.currentQ) || 0,
          lastUpdated: p.lastUpdated || 0
        }))
        .sort((a, b) => (b.score - a.score) || (a.lastUpdated - b.lastUpdated));

      saveActiveRooms(true);

      sendJSON(res, 200, {
        success: true,
        player,
        leaderboard
      });
      return;
    } catch (err) {
      sendJSON(res, 500, { success: false, message: err.message });
      return;
    }
  }

  // 10. [POST] /api/rooms/:pin/lock - Khóa hoặc mở khóa phòng thi
  if (method === 'POST' && pathname.includes('/lock')) {
    try {
      const match = pathname.match(/^\/api\/rooms\/([^/]+)\/lock$/);
      if (!match) {
        sendJSON(res, 400, { success: false, message: 'Đường dẫn không hợp lệ' });
        return;
      }
      const pin = match[1];
      const room = activeRooms.get(pin);
      if (!room) {
        sendJSON(res, 404, { success: false, message: 'Phòng thi không tồn tại hoặc đã hết hạn!' });
        return;
      }

      const body = await readJsonBody(req);
      if (typeof body.isLocked === 'boolean') {
        room.isLocked = body.isLocked;
      } else {
        room.isLocked = !room.isLocked;
      }

      saveActiveRooms();

      sendJSON(res, 200, { success: true, pin, isLocked: room.isLocked });
      return;
    } catch (err) {
      sendJSON(res, 500, { success: false, message: err.message });
      return;
    }
  }

  // 11. [POST] /api/rooms/:pin/start - Chủ phòng kích hoạt bắt đầu làm bài (kèm đếm ngược 5 giây)
  if (method === 'POST' && pathname.includes('/start')) {
    try {
      const match = pathname.match(/^\/api\/rooms\/([^/]+)\/start$/);
      if (!match) {
        sendJSON(res, 400, { success: false, message: 'Đường dẫn không hợp lệ' });
        return;
      }
      const pin = match[1];
      const room = activeRooms.get(pin);
      if (!room) {
        sendJSON(res, 404, { success: false, message: 'Phòng thi không tồn tại hoặc đã hết hạn!' });
        return;
      }

      let body = {};
      try {
        body = await readJsonBody(req);
      } catch (e) {}

      const durationSec = Number(body.countdown) || 5;
      room.status = 'countdown';
      room.countdownSeconds = durationSec;
      room.countdownEnd = Date.now() + (durationSec * 1000);
      room.startedAt = room.countdownEnd;
      room.isLocked = true; // Ngay lập tức chuyển phòng về trạng thái khóa khi bắt đầu

      saveActiveRooms();

      sendJSON(res, 200, {
        success: true,
        status: 'countdown',
        isLocked: true,
        countdownEnd: room.countdownEnd,
        countdownSeconds: durationSec
      });
      return;
    } catch (err) {
      sendJSON(res, 500, { success: false, message: err.message });
      return;
    }
  }

  // 12. [DELETE] /api/rooms/:pin - Xóa phòng thi hoạt động
  if (method === 'DELETE' && pathname.startsWith('/api/rooms/')) {
    const pin = pathname.replace('/api/rooms/', '');
    if (roomCleanupTimers.has(pin)) {
      clearTimeout(roomCleanupTimers.get(pin));
      roomCleanupTimers.delete(pin);
    }
    const deleted = activeRooms.delete(pin);
    if (deleted) saveActiveRooms();
    res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
    res.end(JSON.stringify({ success: true, deleted }));
    return;
  }

  // 13. [GET] /api/server-info - Lấy địa chỉ IP nội bộ (LAN) và URL công khai phục vụ tạo mã QR / kết nối
  if (method === 'GET' && pathname === '/api/server-info') {
    const lanIp = getServerLanIp();
    const publicUrl = process.env.APP_URL || (host && host.includes('ai.studio') ? `${proto}://${host}` : DEFAULT_APP_URL);
    sendJSON(res, 200, {
      success: true,
      lanIp,
      port: PORT,
      lanUrl: `http://${lanIp}:${PORT}`,
      publicUrl
    });
    return;
  }

  // ══════════════════════════════════════════════════════════
  // STATIC FILE SERVING
  // ══════════════════════════════════════════════════════════

  // Gate các trang yêu cầu đăng nhập: chưa có session hợp lệ -> đưa về trang chủ kèm cờ needLogin
  const PROTECTED_PAGES = new Set(['/dashboard.html', '/create-exam.html', '/create-room.html']);
  if (PROTECTED_PAGES.has(pathname) && !getSessionUser(req)) {
    res.writeHead(302, { Location: '/index.html?needLogin=1&redirect=' + encodeURIComponent(pathname) });
    res.end();
    return;
  }

  const safePath = path.normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[\/\\])+/, '');
  const fp = path.join(STATIC_DIR, safePath);

  if (!fp.startsWith(STATIC_DIR) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain;charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(fp);
  if (ext === '.html') {
    try {
      let content = fs.readFileSync(fp, 'utf8');
      const lanIp = getServerLanIp();
      const publicUrl = process.env.APP_URL || (host && host.includes('ai.studio') ? `${proto}://${host}` : DEFAULT_APP_URL);
      const injectScript = `<script>window.__SERVER_LAN_URL__ = "http://${lanIp}:${PORT}"; window.__SERVER_LAN_IP__ = "${lanIp}"; window.__SERVER_PUBLIC_URL__ = "${publicUrl}";</script>`;
      content = content.replace('</head>', `${injectScript}</head>`);
      res.writeHead(200, { 'Content-Type': MIME[ext] });
      res.end(content);
      return;
    } catch (e) {}
  }

  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  const lanIp = getServerLanIp();
  const publicUrl = process.env.APP_URL || DEFAULT_APP_URL;
  console.log(`Mini Quiz Classroom server running at:`);
  console.log(`- Local:    http://localhost:${PORT}`);
  console.log(`- LAN:      http://${lanIp}:${PORT}`);
  console.log(`- Cloud:    ${publicUrl}`);
  console.log(`- Storage:  ${DATA_DIR}`);
  console.log(`  + Active rooms: ${activeRooms.size} phòng đang nạp`);
});
