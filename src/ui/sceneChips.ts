import { ALL_SCENES, SCENE_META, type Scene } from '../scenes';

/**
 * 「デート」「友達と」などのシーンのチップ。カテゴリのチップとは独立していて、
 * 選べるのは1つだけ（もう一度押すと外れる）。
 */
export class SceneChips {
  private buttons = new Map<Scene, HTMLButtonElement>();
  private counts = new Map<Scene, HTMLSpanElement>();
  private selected: Scene | null = null;

  constructor(root: HTMLElement, onChange: (scene: Scene | null) => void) {
    const head = document.createElement('span');
    head.className = 'chips__head';
    head.textContent = 'おすすめ';
    root.appendChild(head);

    for (const scene of ALL_SCENES) {
      const meta = SCENE_META[scene];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip chip--scene';
      btn.style.setProperty('--chip-color', meta.color);
      btn.setAttribute('aria-pressed', 'false');

      const text = document.createElement('span');
      text.textContent = `${meta.emoji} ${meta.label}`;
      const count = document.createElement('span');
      count.className = 'chip__count';
      btn.append(text, count);

      btn.addEventListener('click', () => {
        this.selected = this.selected === scene ? null : scene;
        this.sync();
        onChange(this.selected);
      });

      this.buttons.set(scene, btn);
      this.counts.set(scene, count);
      root.appendChild(btn);
    }
  }

  private sync(): void {
    for (const [scene, btn] of this.buttons) {
      btn.setAttribute('aria-pressed', String(scene === this.selected));
    }
  }

  /** 一覧側の「×」から外したときなど、外から選択を変える。onChange は呼ばない。 */
  set(scene: Scene | null): void {
    this.selected = scene;
    this.sync();
  }

  setCounts(byScene: Map<Scene, number>): void {
    for (const scene of ALL_SCENES) {
      const n = byScene.get(scene) ?? 0;
      this.counts.get(scene)!.textContent = n > 0 ? String(n) : '';
    }
  }
}
