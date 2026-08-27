/* global bootstrap, io, RescueMap */
(function initDashboard() {
  const state = { events: [], selectedId: null, listFilter: 'ACTIVE', socketConnected: false };
  const statusLabels = { SOS: 'SOS', CONFIRMED: 'ĐÃ XÁC NHẬN', RESCUING: 'ĐANG CỨU HỘ', RESCUED: 'ĐÃ CỨU', CANCELLED: 'ĐÃ HỦY' };
  const activeStatuses = ['SOS', 'CONFIRMED', 'RESCUING'];
  const els = {
    list: document.getElementById('incidentList'), panel: document.getElementById('detailPanel'), backdrop: document.getElementById('panelBackdrop'),
    detailDevice: document.getElementById('detailDevice'), detailContent: document.getElementById('detailContent'), actions: document.getElementById('detailActions'),
    distance: document.getElementById('distanceBox'), server: document.getElementById('serverStatus'), historyBody: document.getElementById('historyTableBody'),
    systemDatabase: document.getElementById('systemDatabase'), gatewayApi: document.getElementById('gatewayApi'), systemPort: document.getElementById('systemPort'),
    internetWarning: document.getElementById('internetWarning'), settingsMessage: document.getElementById('settingsMessage')
  };
  const confirmModal = new bootstrap.Modal('#confirmModal');
  const toast = new bootstrap.Toast('#appToast', { delay: 5500 });

  async function api(path, options = {}) {
    const response = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    let body;
    try { body = await response.json(); } catch { body = { success: false, message: 'Phản hồi máy chủ không hợp lệ' }; }
    if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
    return body.data ?? body;
  }

  async function loadEvents(showError = true) {
    setLoading();
    try {
      state.events = await api('/api/rescues');
      renderAll();
      await loadDeviceSummary();
    } catch (error) {
      els.list.innerHTML = emptyState('Không tải được dữ liệu', 'bi-database-x');
      if (showError) notify('Lỗi dữ liệu', error.message, true);
    }
  }

  async function loadDeviceSummary() {
    try { const result = await api('/api/devices/summary'); document.getElementById('statOnline').textContent = result.online; } catch { document.getElementById('statOnline').textContent = '--'; }
  }

  async function loadSystemInfo() {
    try {
      const info = await api('/api/system/info');
      document.getElementById('systemServer').textContent = String(info.server).toUpperCase();
      els.systemDatabase.textContent = String(info.database).toUpperCase();
      els.systemDatabase.classList.toggle('is-offline', info.database !== 'online');
      els.gatewayApi.textContent = info.gateway_api;
      els.gatewayApi.dataset.value = info.gateway_api;
      els.systemPort.textContent = info.port;
    } catch {
      document.getElementById('systemServer').textContent = 'OFFLINE';
      els.systemDatabase.textContent = '--';
    }
  }

  function renderAll() {
    renderStats();
    renderList();
    // Chi hien marker cho sự kien dang hoat dong (SOS/CONFIRMED/RESCUING).
    // Khi mot su kien chuyen sang RESCUED/CANCELLED, no tu dong bien mat
    // khoi ban do (RescueMap.render go bo moi marker khong con trong danh
    // sach nay), giu ban do gon va nhanh khi lich su tich luy nhieu.
    RescueMap.render(state.events.filter((event) => activeStatuses.includes(event.status)), selectEvent);
  }

  function filteredEvents() {
    if (state.listFilter === 'ALL') return state.events;
    if (state.listFilter === 'ACTIVE') return state.events.filter((event) => activeStatuses.includes(event.status));
    return state.events.filter((event) => event.status === state.listFilter);
  }

  function renderStats() {
    const ids = { SOS: 'statSOS', CONFIRMED: 'statConfirmed', RESCUING: 'statRescuing', RESCUED: 'statRescued' };
    Object.entries(ids).forEach(([status, id]) => {
      document.getElementById(id).textContent = state.events.filter((event) => event.status === status).length;
    });
  }

  function renderList() {
    const events = filteredEvents();
    if (!events.length) { els.list.innerHTML = emptyState('Không có sự kiện phù hợp', 'bi-check2-circle'); return; }
    els.list.innerHTML = events.map((event) => `
      <button class="incident-card ${Number(event.id) === state.selectedId ? 'selected' : ''}" data-id="${event.id}" style="--status-color:${RescueMap.statusColors[event.status]}">
        <span class="incident-top"><strong class="incident-device">${escapeHtml(event.device_id)}</strong><span class="status-badge">${statusLabels[event.status]}</span></span>
        <span class="incident-coordinates"><span><i class="bi bi-geo-alt-fill"></i> ${coordinate(event.latitude)}, ${coordinate(event.longitude)}</span><span>#${event.id}</span></span>
        <span class="incident-meta"><span><i class="bi bi-clock"></i> ${elapsed(event.created_at)}</span><span><i class="bi bi-battery-half"></i> ${event.battery ?? '--'}%</span><span><i class="bi bi-reception-3"></i> ${event.rssi ?? '--'} dBm</span></span>
        <span class="incident-meta mt-2"><span><i class="online-indicator ${Number(event.device_online) ? 'online' : ''}"></i>${Number(event.device_online) ? 'ONLINE' : 'OFFLINE'}</span><span>${formatDate(event.created_at)}</span></span>
      </button>`).join('');
    els.list.querySelectorAll('[data-id]').forEach((card) => card.addEventListener('click', () => selectEvent(Number(card.dataset.id))));
  }

  async function selectEvent(id) {
    state.selectedId = Number(id);
    renderList();
    openPanel();
    els.detailContent.innerHTML = '<div class="loading-line"></div><div class="loading-line"></div>';
    els.actions.innerHTML = '';
    els.distance.classList.add('d-none');
    RescueMap.focus(id);
    try {
      const event = await api(`/api/rescues/${id}`);
      upsertLocal(event);
      renderDetail(event);
      RescueMap.showHistory(event.history);
    } catch (error) { notify('Không mở được sự kiện', error.message, true); closePanel(); }
  }

  function renderDetail(event) {
    els.detailDevice.textContent = event.device_id;
    els.detailContent.innerHTML = `
      <div class="detail-status-row" style="--status-color:${RescueMap.statusColors[event.status]}"><span class="status-badge">${statusLabels[event.status]}</span><span class="text-secondary mono">#${event.id}</span></div>
      <div class="detail-grid">
        ${metric('Vĩ độ', coordinate(event.latitude))}${metric('Kinh độ', coordinate(event.longitude))}
        ${metric('Thời gian SOS', formatDate(event.created_at))}${metric('Thời gian đã qua', elapsed(event.created_at))}
        ${metric('Pin thiết bị', event.battery == null ? '--' : `${event.battery}%`)}${metric('Tín hiệu RSSI', event.rssi == null ? '--' : `${event.rssi} dBm`)}
        ${metric('Sai số GPS', event.accuracy == null ? '--' : `${event.accuracy} m`)}${metric('Thiết bị', Number(event.device_online) ? 'ONLINE' : 'OFFLINE')}
      </div>
      ${event.confirmed_by ? `<div class="detail-message" style="--status-color:${RescueMap.statusColors[event.status]}"><strong>Đơn vị tiếp nhận:</strong> ${escapeHtml(event.confirmed_by)}</div>` : ''}
      ${event.message ? `<div class="detail-message" style="--status-color:${RescueMap.statusColors[event.status]}">${escapeHtml(event.message)}</div>` : ''}`;
    renderActions(event);
  }

  function renderActions(event) {
    let primary = '';
    if (event.status === 'SOS') primary = actionButton('confirm', 'bi-check2-circle', 'XÁC NHẬN VỊ TRÍ', 'action-primary');
    if (event.status === 'CONFIRMED') primary = actionButton('start', 'bi-truck-front-fill', 'BẮT ĐẦU CỨU HỘ', 'action-primary');
    if (event.status === 'RESCUING') primary = actionButton('rescue', 'bi-shield-check', 'ĐÃ CỨU ĐƯỢC NẠN NHÂN', 'action-primary');
    els.actions.innerHTML = `<div style="--status-color:${RescueMap.statusColors[event.status]}">${primary}</div>
      ${actionButton('route', 'bi-sign-turn-right-fill', 'CHỈ ĐƯỜNG TỚI NẠN NHÂN', 'action-route')}
      <a class="action-button action-route d-grid place-items-center text-decoration-none align-items-center" style="display:grid" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${event.latitude},${event.longitude}"><span><i class="bi bi-map-fill"></i>MỞ GOOGLE MAPS</span></a>
      ${activeStatuses.includes(event.status) ? actionButton('cancel', 'bi-x-octagon', 'HỦY SỰ KIỆN', 'action-cancel') : ''}`;
    els.actions.querySelector('[data-action="confirm"]')?.addEventListener('click', () => confirmModal.show());
    els.actions.querySelector('[data-action="start"]')?.addEventListener('click', () => changeStatus(event.id, 'start'));
    els.actions.querySelector('[data-action="rescue"]')?.addEventListener('click', () => changeStatus(event.id, 'rescue'));
    els.actions.querySelector('[data-action="cancel"]')?.addEventListener('click', () => { if (window.confirm('Hủy sự kiện cứu hộ này?')) changeStatus(event.id, 'cancel'); });
    els.actions.querySelector('[data-action="route"]')?.addEventListener('click', () => locateRescuer(event));
  }

  async function changeStatus(id, action, body) {
    try {
      const event = await api(`/api/rescues/${id}/${action}`, { method: 'PUT', body: body ? JSON.stringify(body) : '{}' });
      upsertLocal(event); renderAll(); renderDetail(event); notify('Đã cập nhật', `Sự kiện #${id}: ${statusLabels[event.status]}`);
      if (action === 'confirm') confirmModal.hide();
    } catch (error) { notify('Không thể cập nhật', error.message, true); }
  }

  function locateRescuer(event) {
    if (!navigator.geolocation) { notify('Không hỗ trợ định vị', 'Trình duyệt này không có Geolocation API.', true); return; }
    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude } = position.coords;
      const distance = haversine(latitude, longitude, Number(event.latitude), Number(event.longitude));
      RescueMap.showRescuer(latitude, longitude);
      els.distance.innerHTML = `<span>Khoảng cách đường chim bay</span><strong>${distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(2)} km`}</strong>`;
      els.distance.classList.remove('d-none');
    }, (error) => notify('Không lấy được vị trí', geolocationError(error), true), { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
  }

  async function loadHistory() {
    const params = new URLSearchParams();
    const date = document.getElementById('historyDate').value;
    const device = document.getElementById('historyDevice').value.trim();
    const status = document.getElementById('historyStatus').value;
    if (date) params.set('date', date); if (device) params.set('device', device); if (status) params.set('status', status);
    els.historyBody.innerHTML = '<tr><td colspan="9">Đang tải...</td></tr>';
    try {
      const rows = await api(`/api/rescues?${params}`);
      els.historyBody.innerHTML = rows.length ? rows.map((event) => `<tr data-id="${event.id}"><td class="mono">#${event.id}</td><td class="mono">${escapeHtml(event.device_id)}</td><td>${formatDate(event.created_at)}</td><td>${formatDate(event.confirmed_at)}</td><td>${formatDate(event.rescuing_at)}</td><td>${formatDate(event.rescued_at)}</td><td><span class="status-badge" style="--status-color:${RescueMap.statusColors[event.status]}">${statusLabels[event.status]}</span></td><td class="mono">${coordinate(event.latitude)}, ${coordinate(event.longitude)}</td><td>${escapeHtml(event.confirmed_by || '--')}</td></tr>`).join('') : '<tr><td colspan="9">Không có dữ liệu phù hợp.</td></tr>';
      els.historyBody.querySelectorAll('tr[data-id]').forEach((row) => row.addEventListener('click', () => { switchView('operations'); selectEvent(Number(row.dataset.id)); }));
    } catch (error) { els.historyBody.innerHTML = `<tr><td colspan="9">${escapeHtml(error.message)}</td></tr>`; }
  }

  function bindEvents() {
    document.getElementById('refreshButton').addEventListener('click', () => loadEvents());
    document.getElementById('fitMapButton').addEventListener('click', RescueMap.fitAll);
    document.getElementById('closeDetail').addEventListener('click', closePanel);
    els.backdrop.addEventListener('click', closePanel);
    document.querySelectorAll('.filter-chip').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.filter-chip').forEach((item) => item.classList.remove('active')); button.classList.add('active'); state.listFilter = button.dataset.status; renderList(); }));
    document.querySelectorAll('.view-tab').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
    document.getElementById('historyFilters').addEventListener('submit', (event) => { event.preventDefault(); loadHistory(); });
    document.getElementById('clearHistoryFilters').addEventListener('click', () => { document.getElementById('historyFilters').reset(); loadHistory(); });
    document.getElementById('submitConfirm').addEventListener('click', () => { const name = document.getElementById('confirmedBy').value.trim(); if (!name) { notify('Thiếu thông tin', 'Nhập đội hoặc nhân viên tiếp nhận.', true); return; } changeStatus(state.selectedId, 'confirm', { confirmed_by: name }); });
    document.getElementById('copyApiButton').addEventListener('click', copyGatewayApi);
    document.getElementById('settingsForm').addEventListener('submit', saveSettings);
    document.getElementById('testMysqlButton').addEventListener('click', testMysqlSettings);
    document.getElementById('restartServerButton').addEventListener('click', restartDesktopServer);
    document.getElementById('startMysqlButton').addEventListener('click', tryStartMysql);
    window.addEventListener('resize', RescueMap.invalidate);
    window.addEventListener('online', () => setInternetStatus(true));
    window.addEventListener('offline', () => setInternetStatus(false));
    window.addEventListener('map:internet-unavailable', () => setInternetStatus(false));
    window.addEventListener('map:internet-restored', () => { if (navigator.onLine) setInternetStatus(true); });
  }

  function connectSocket() {
    const socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => setServerState(true));
    socket.on('disconnect', () => setServerState(false));
    socket.on('rescue:new', (event) => {
      upsertLocal(event, true);
      renderAll();
      alertNewRescue(event);
      window.electronAPI?.reportRealtime({ eventId: event.id, markerCount: document.querySelectorAll('.rescue-marker').length });
    });
    socket.on('rescue:update', (event) => { upsertLocal(event); renderAll(); if (Number(event.id) === state.selectedId) selectEvent(event.id); });
    socket.on('gps:update', (update) => {
      if (!update.event_id) return;
      const current = state.events.find((event) => Number(event.id) === Number(update.event_id));
      if (current) {
        Object.assign(current, update, { id: Number(update.event_id) });
        if (activeStatuses.includes(current.status)) RescueMap.upsert(current, selectEvent);
        renderList();
      }
    });
  }

  function alertNewRescue(event) {
    notify('CẢNH BÁO SOS MỚI', `${event.device_id} vừa phát tín hiệu khẩn cấp.`, true);
    playAlertTone();
  }

  function playAlertTone() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContext();
      [0, .22].forEach((offset) => { const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.connect(gain); gain.connect(context.destination); oscillator.frequency.value = 880; gain.gain.setValueAtTime(.12, context.currentTime + offset); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + offset + .16); oscillator.start(context.currentTime + offset); oscillator.stop(context.currentTime + offset + .17); });
    } catch { /* Trình duyệt có thể chặn âm thanh trước tương tác đầu tiên. */ }
  }

  function switchView(view) {
    document.querySelectorAll('.view-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    document.getElementById('operationsView').classList.toggle('active', view === 'operations');
    document.getElementById('historyView').classList.toggle('active', view === 'history');
    document.getElementById('settingsView').classList.toggle('active', view === 'settings');
    if (view === 'history') loadHistory();
    if (view === 'settings') loadSettings();
    if (view === 'operations') RescueMap.invalidate();
  }

  async function copyGatewayApi() {
    const value = els.gatewayApi.dataset.value || els.gatewayApi.textContent;
    try {
      if (window.electronAPI) await window.electronAPI.copyText(value);
      else await navigator.clipboard.writeText(value);
      notify('Đã sao chép', value);
    } catch (error) { notify('Không thể sao chép', error.message, true); }
  }

  function settingsInput() {
    return {
      dbHost: document.getElementById('settingDbHost').value.trim(),
      dbPort: Number(document.getElementById('settingDbPort').value),
      dbUser: document.getElementById('settingDbUser').value.trim(),
      dbPassword: document.getElementById('settingDbPassword').value,
      dbName: document.getElementById('settingDbName').value.trim(),
      apiPort: Number(document.getElementById('settingApiPort').value),
      gatewayApiKey: document.getElementById('settingGatewayKey').value,
      startWithWindows: document.getElementById('settingStartWindows').checked,
      minimizeToTray: document.getElementById('settingMinimizeTray').checked
    };
  }

  async function loadSettings() {
    if (!window.electronAPI) {
      showSettingsMessage('Cài đặt desktop chỉ khả dụng khi chạy bằng Electron.', true);
      document.querySelectorAll('#settingsForm button, #settingsForm input').forEach((control) => { control.disabled = true; });
      return;
    }
    try {
      const config = await window.electronAPI.getConfig();
      document.getElementById('settingDbHost').value = config.dbHost;
      document.getElementById('settingDbPort').value = config.dbPort;
      document.getElementById('settingDbUser').value = config.dbUser;
      document.getElementById('settingDbPassword').value = config.dbPassword;
      document.getElementById('settingDbName').value = config.dbName;
      document.getElementById('settingApiPort').value = config.apiPort;
      document.getElementById('settingGatewayKey').value = config.gatewayApiKey;
      document.getElementById('settingStartWindows').checked = config.startWithWindows;
      document.getElementById('settingMinimizeTray').checked = config.minimizeToTray;
    } catch (error) { showSettingsMessage(error.message, true); }
  }

  async function testMysqlSettings() {
    if (!window.electronAPI) return;
    const button = document.getElementById('testMysqlButton');
    button.disabled = true;
    showSettingsMessage('Đang kiểm tra kết nối MySQL...');
    try {
      const result = await window.electronAPI.testDatabase(settingsInput());
      showSettingsMessage(result.message, !result.success);
    } catch (error) { showSettingsMessage(error.message, true); }
    finally { button.disabled = false; }
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.saveConfig(settingsInput());
      showSettingsMessage('Đã lưu cấu hình. Khởi động lại server để áp dụng toàn bộ thay đổi.');
    } catch (error) { showSettingsMessage(error.message, true); }
  }

  async function restartDesktopServer() {
    if (!window.electronAPI) return;
    const button = document.getElementById('restartServerButton');
    button.disabled = true;
    showSettingsMessage('Đang khởi động lại server...');
    try { await window.electronAPI.restartServer(); }
    catch (error) { showSettingsMessage(error.message, true); button.disabled = false; }
  }

  async function tryStartMysql() {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.startMysqlService();
      showSettingsMessage(result.message || 'Đã gửi yêu cầu khởi động MySQL80.');
    } catch (error) { showSettingsMessage(error.message, true); }
  }

  function showSettingsMessage(message, error = false) {
    els.settingsMessage.textContent = message;
    els.settingsMessage.classList.remove('d-none');
    els.settingsMessage.classList.toggle('error', error);
  }

  function setInternetStatus(online) { els.internetWarning.classList.toggle('d-none', online); }

  function upsertLocal(event, prepend = false) {
    const index = state.events.findIndex((item) => Number(item.id) === Number(event.id));
    if (index >= 0) state.events[index] = { ...state.events[index], ...event };
    else if (prepend) state.events.unshift(event); else state.events.push(event);
  }
  function openPanel() { els.panel.classList.add('open'); els.panel.setAttribute('aria-hidden', 'false'); els.backdrop.classList.add('open'); }
  function closePanel() { els.panel.classList.remove('open'); els.panel.setAttribute('aria-hidden', 'true'); els.backdrop.classList.remove('open'); state.selectedId = null; renderList(); RescueMap.showHistory([]); }
  function setServerState(online) { state.socketConnected = online; els.server.className = `server-state ${online ? '' : 'is-offline'}`; els.server.innerHTML = `<span class="status-dot"></span> SERVER ${online ? 'ONLINE' : 'OFFLINE'}`; }
  function setLoading() { els.list.innerHTML = '<div class="loading-line"></div><div class="loading-line"></div><div class="loading-line"></div>'; }
  function metric(label, value) { return `<div class="detail-metric"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`; }
  function actionButton(action, icon, label, className) { return `<button class="action-button ${className} w-100" data-action="${action}"><i class="bi ${icon}"></i>${label}</button>`; }
  function emptyState(text, icon) { return `<div class="empty-state"><i class="bi ${icon}"></i>${text}</div>`; }
  function coordinate(value) { return Number.isFinite(Number(value)) ? Number(value).toFixed(6) : '--'; }
  function parseDate(value) { return value ? new Date(String(value).includes('T') ? value : String(value).replace(' ', 'T')) : null; }
  function formatDate(value) { const date = parseDate(value); return date && !Number.isNaN(date) ? date.toLocaleString('vi-VN') : '--'; }
  function elapsed(value) { const date = parseDate(value); if (!date) return '--'; const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000)); if (seconds < 60) return `${seconds} giây`; if (seconds < 3600) return `${Math.floor(seconds / 60)} phút`; if (seconds < 86400) return `${Math.floor(seconds / 3600)} giờ ${Math.floor((seconds % 3600) / 60)} phút`; return `${Math.floor(seconds / 86400)} ngày`;
  }
  function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value ?? ''; return div.innerHTML; }
  function notify(title, message, danger = false) { document.getElementById('toastTitle').textContent = title; document.getElementById('toastMessage').textContent = message; const icon = document.getElementById('toastIcon'); icon.className = `bi ${danger ? 'bi-exclamation-triangle-fill text-danger' : 'bi-check-circle-fill text-success'} me-2`; toast.show(); }
  function haversine(lat1, lon1, lat2, lon2) { const rad = (degrees) => degrees * Math.PI / 180; const dLat = rad(lat2 - lat1); const dLon = rad(lon2 - lon1); const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
  function geolocationError(error) { return ({ 1: 'Bạn chưa cấp quyền truy cập vị trí.', 2: 'Không xác định được vị trí hiện tại.', 3: 'Yêu cầu định vị đã hết thời gian.' })[error.code] || error.message; }

  setInterval(() => { document.getElementById('liveClock').textContent = new Date().toLocaleTimeString('vi-VN', { hour12: false }); }, 1000);
  setInterval(() => { renderList(); loadDeviceSummary(); loadSystemInfo(); }, 30000);
  bindEvents();
  setInternetStatus(navigator.onLine);
  connectSocket();
  loadSystemInfo();
  loadEvents(false).finally(() => window.electronAPI?.dashboardReady());
}());
