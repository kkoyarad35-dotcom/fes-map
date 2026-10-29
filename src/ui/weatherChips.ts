export type Weather = 'sunny' | 'rainy';

export const WEATHER_META: Record<Weather, { label: string; emoji: string; color: string; note: string }> = {
  sunny: { label: '晴れの日', emoji: '☀️', color: '#f59e0b', note: '外で楽しむもの' },
  rainy: { label: '雨の日', emoji: '☔', color: '#0284c7', note: '屋内で楽しめるもの' },
};

const NONE = '';

/**
 * 「晴れの日」「雨の日」の選択。晴れなら屋外、雨なら屋内のものだけにする
 * （判定は classify.ts の indoorOf。どちらとも分からないものは両方に出す）。
 * 「だれと」と同じく、カテゴリの段に小さなプルダウンを1つ置く。
 */
export class WeatherChips {
  private select: HTMLSelectElement;

  constructor(root: HTMLElement, onChange: (weather: Weather | null) => void) {
    this.select = document.createElement('select');
    this.select.className = 'chip chip--scene';
    this.select.setAttribute('aria-label', '天気で絞り込む');

    const none = document.createElement('option');
    none.value = NONE;
    none.textContent = '🌤 天気';
    this.select.appendChild(none);

    for (const [key, meta] of Object.entries(WEATHER_META)) {
      const opt = document.createElement('option');
      opt.value = key;
      // 選んだあとはチップの幅に収まるよう短く。何に絞ったかは一覧の見出しで説明する
      opt.textContent = `${meta.emoji} ${meta.label}`;
      this.select.appendChild(opt);
    }

    this.select.addEventListener('change', () => {
      this.sync();
      onChange((this.select.value || null) as Weather | null);
    });
    // 「だれと」のすぐ後ろに置く
    const scene = root.querySelector('.chip--scene');
    if (scene) scene.after(this.select);
    else root.prepend(this.select);
  }

  private sync(): void {
    const weather = (this.select.value || null) as Weather | null;
    this.select.setAttribute('aria-pressed', String(weather !== null));
    this.select.style.setProperty('--chip-color', weather ? WEATHER_META[weather].color : '');
  }

  /** 一覧側の「×」から外したときなど、外から選択を変える。onChange は呼ばない。 */
  set(weather: Weather | null): void {
    this.select.value = weather ?? NONE;
    this.sync();
  }
}
