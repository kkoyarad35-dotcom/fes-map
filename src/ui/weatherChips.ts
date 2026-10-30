/**
 * 「☔ 雨の日」のチップ。押すと屋内で楽しめるものだけにする
 * （判定は classify.ts の indoorOf。屋内か屋外か分からないものは残す）。
 * 以前は「晴れの日」も選べるプルダウンだったが、晴れなら何でも行けるので要らないと言われて外した。
 * 「だれと」のすぐ後ろに置く。
 */
export const RAIN_LABEL = '☔ 雨の日';
export const RAIN_NOTE = '屋内で楽しめるもの';

export class RainChip {
  private button: HTMLButtonElement;
  private on = false;

  constructor(root: HTMLElement, onChange: (rainy: boolean) => void) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'chip';
    this.button.textContent = RAIN_LABEL;
    this.button.title = RAIN_NOTE;
    this.button.style.setProperty('--chip-color', '#0284c7');
    this.button.addEventListener('click', () => {
      this.set(!this.on);
      onChange(this.on);
    });
    this.set(false);

    const scene = root.querySelector('.chip--scene');
    if (scene) scene.after(this.button);
    else root.prepend(this.button);
  }

  /** 一覧側の「×」から外したときなど、外から選択を変える。onChange は呼ばない。 */
  set(on: boolean): void {
    this.on = on;
    this.button.setAttribute('aria-pressed', String(on));
  }
}
