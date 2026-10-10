import { ALL_CATEGORIES, CATEGORY_META, type EventCategory } from '../types';

/**
 * カテゴリの絞り込みチップ。
 * 「すべて」を含め、選択なし = すべて表示、という素直な挙動にしている。
 */
export class CategoryChips {
  private buttons = new Map<EventCategory | 'all', HTMLButtonElement>();
  private counts = new Map<EventCategory | 'all', HTMLSpanElement>();
  private selected = new Set<EventCategory>();
  private onChange: (selected: Set<EventCategory>) => void;

  constructor(root: HTMLElement, onChange: (selected: Set<EventCategory>) => void) {
    this.onChange = onChange;

    this.add(root, 'all', 'すべて', '✨', null);
    for (const cat of ALL_CATEGORIES) {
      const meta = CATEGORY_META[cat];
      this.add(root, cat, meta.label, meta.emoji, meta.color);
    }
    this.sync();
  }

  private add(
    root: HTMLElement,
    key: EventCategory | 'all',
    label: string,
    emoji: string,
    color: string | null,
  ): void {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    if (color) btn.style.setProperty('--chip-color', color);

    const text = document.createElement('span');
    text.textContent = `${emoji} ${label}`;
    const count = document.createElement('span');
    count.className = 'chip__count';

    btn.append(text, count);
    btn.addEventListener('click', () => this.toggle(key));

    this.buttons.set(key, btn);
    this.counts.set(key, count);
    root.appendChild(btn);
  }

  private toggle(key: EventCategory | 'all'): void {
    if (key === 'all') {
      this.selected.clear();
    } else if (this.selected.has(key)) {
      this.selected.delete(key);
    } else {
      this.selected.add(key);
    }
    this.sync();
    this.onChange(new Set(this.selected));
  }

  private sync(): void {
    for (const [key, btn] of this.buttons) {
      const on = key === 'all' ? this.selected.size === 0 : this.selected.has(key);
      btn.setAttribute('aria-pressed', String(on));
    }
  }

  /** その日のカテゴリ別件数をチップに出す。0件のカテゴリは薄くする。 */
  setCounts(byCategory: Map<EventCategory, number>, total: number): void {
    this.counts.get('all')!.textContent = total > 0 ? String(total) : '';
    for (const cat of ALL_CATEGORIES) {
      const n = byCategory.get(cat) ?? 0;
      this.counts.get(cat)!.textContent = n > 0 ? String(n) : '';
      const btn = this.buttons.get(cat)!;
      btn.style.opacity = n === 0 && !this.selected.has(cat) ? '0.42' : '1';
    }
  }

  get value(): Set<EventCategory> {
    return new Set(this.selected);
  }
}
