import { ALL_SCENES, SCENE_META, type Scene } from '../scenes';

const NONE = '';

/**
 * 「デート」「友達と」などのシーンの選択。カテゴリのチップとは独立していて、
 * 選べるのは1つだけ。上部を1段減らすため、チップを並べずにカテゴリの段の先頭に
 * 小さなプルダウンを1つ置く（スマホでは OS の選択画面が出る）。
 */
export class SceneChips {
  private select: HTMLSelectElement;
  private options = new Map<Scene, HTMLOptionElement>();

  constructor(root: HTMLElement, onChange: (scene: Scene | null) => void) {
    this.select = document.createElement('select');
    this.select.className = 'chip chip--scene';
    this.select.setAttribute('aria-label', '誰と行くかでおすすめを見る');

    const none = document.createElement('option');
    none.value = NONE;
    none.textContent = '👥 だれと';
    this.select.appendChild(none);

    for (const scene of ALL_SCENES) {
      const opt = document.createElement('option');
      opt.value = scene;
      this.options.set(scene, opt);
      this.select.appendChild(opt);
    }
    this.setCounts(new Map());

    this.select.addEventListener('change', () => {
      this.sync();
      onChange((this.select.value || null) as Scene | null);
    });
    root.prepend(this.select);
  }

  private sync(): void {
    const scene = (this.select.value || null) as Scene | null;
    this.select.setAttribute('aria-pressed', String(scene !== null));
    this.select.style.setProperty('--chip-color', scene ? SCENE_META[scene].color : '');
  }

  /** 一覧側の「×」から外したときなど、外から選択を変える。onChange は呼ばない。 */
  set(scene: Scene | null): void {
    this.select.value = scene ?? NONE;
    this.sync();
  }

  setCounts(byScene: Map<Scene, number>): void {
    for (const scene of ALL_SCENES) {
      const meta = SCENE_META[scene];
      const n = byScene.get(scene) ?? 0;
      this.options.get(scene)!.textContent = `${meta.emoji} ${meta.label}${n > 0 ? `（${n}）` : ''}`;
    }
  }
}
