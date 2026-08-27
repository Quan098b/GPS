/* global L */
(function exposeRescueMap() {
  const statusColors = { SOS: '#f04444', CONFIRMED: '#f59e42', RESCUING: '#3e98e8', RESCUED: '#36b37e', CANCELLED: '#7b8792' };
  const markers = new Map();
  let routeLine = null;
  let rescuerMarker = null;

  const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([21.0285, 105.8542], 7);
  const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  tileLayer.on('tileerror', () => window.dispatchEvent(new CustomEvent('map:internet-unavailable')));
  tileLayer.on('load', () => window.dispatchEvent(new CustomEvent('map:internet-restored')));

  function iconFor(status) {
    const color = statusColors[status] || statusColors.CANCELLED;
    return L.divIcon({ className: '', html: `<div class="rescue-marker ${status === 'SOS' ? 'sos' : ''}" style="--marker-color:${color}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
  }

  function popup(event) {
    return `<strong>${escapeHtml(event.device_id)}</strong><br>${Number(event.latitude).toFixed(6)}, ${Number(event.longitude).toFixed(6)}<br>${formatTime(event.created_at)}<br>Pin: ${event.battery ?? '--'}% &nbsp; RSSI: ${event.rssi ?? '--'} dBm<br>${event.status || 'GPS'}`;
  }

  function upsert(event, onSelect) {
    if (!event.id || !Number.isFinite(Number(event.latitude)) || !Number.isFinite(Number(event.longitude))) return;
    const position = [Number(event.latitude), Number(event.longitude)];
    let marker = markers.get(Number(event.id));
    if (!marker) {
      marker = L.marker(position, { icon: iconFor(event.status), riseOnHover: true }).addTo(map);
      marker.on('click', () => onSelect(Number(event.id)));
      markers.set(Number(event.id), marker);
    } else {
      marker.setLatLng(position).setIcon(iconFor(event.status));
    }
    marker.bindPopup(popup(event));
  }

  function render(events, onSelect) {
    const ids = new Set(events.map((event) => Number(event.id)));
    markers.forEach((marker, id) => {
      if (!ids.has(id)) { map.removeLayer(marker); markers.delete(id); }
    });
    events.forEach((event) => upsert(event, onSelect));
  }

  function fitAll() {
    const points = [...markers.values()].map((marker) => marker.getLatLng());
    if (rescuerMarker) points.push(rescuerMarker.getLatLng());
    if (points.length === 1) map.setView(points[0], 15);
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [45, 45], maxZoom: 16 });
  }

  function focus(id) {
    const marker = markers.get(Number(id));
    if (marker) { map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 15), { duration: .6 }); marker.openPopup(); }
  }

  function showHistory(history) {
    if (routeLine) map.removeLayer(routeLine);
    routeLine = null;
    const points = (history || []).map((point) => [Number(point.latitude), Number(point.longitude)]).filter((point) => point.every(Number.isFinite));
    if (points.length > 1) routeLine = L.polyline(points, { color: '#58c5ca', weight: 4, opacity: .75, dashArray: '7 7' }).addTo(map);
  }

  function showRescuer(latitude, longitude) {
    const position = [latitude, longitude];
    const icon = L.divIcon({ className: '', html: '<div class="rescuer-marker"></div>', iconSize: [17, 17], iconAnchor: [8, 8] });
    if (!rescuerMarker) rescuerMarker = L.marker(position, { icon, zIndexOffset: 1000 }).addTo(map).bindPopup('Vị trí đội cứu hộ');
    else rescuerMarker.setLatLng(position);
    fitAll();
  }

  function invalidate() { setTimeout(() => map.invalidateSize(), 80); }
  function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value ?? ''; return div.innerHTML; }
  function formatTime(value) { return value ? new Date(String(value).replace(' ', 'T')).toLocaleString('vi-VN') : '--'; }

  window.RescueMap = { render, upsert, focus, fitAll, showHistory, showRescuer, invalidate, statusColors };
}());
