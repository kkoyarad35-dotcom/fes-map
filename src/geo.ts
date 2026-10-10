export interface LatLon {
  lat: number;
  lon: number;
}

/** 位置情報が取れなかったときの初期表示（東京駅）。 */
export const FALLBACK_CENTER: LatLon = { lat: 35.681236, lon: 139.767125 };

/**
 * 2点間の距離をメートルで返す（Haversine）。
 * 数十km程度の距離しか扱わないので、この精度で十分。
 */
export function distanceMeters(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10}m`;
  if (m < 10000) return `${(m / 1000).toFixed(1)}km`;
  return `${Math.round(m / 1000)}km`;
}

/**
 * 現在地を取得する。
 * geolocation は HTTPS か localhost でしか動かないので、
 * 失敗しても落とさずに null を返し、呼び出し側でフォールバックさせる。
 */
export function getCurrentPosition(timeoutMs = 8000): Promise<LatLon | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}

/** 現在地を追跡する。停止用の関数を返す。 */
export function watchPosition(onUpdate: (p: LatLon) => void): () => void {
  if (!('geolocation' in navigator)) return () => {};
  const id = navigator.geolocation.watchPosition(
    (pos) => onUpdate({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
    () => {},
    { enableHighAccuracy: true, maximumAge: 30000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
