export type SheetSnap = 'peek' | 'half' | 'full';

/** peek 状態で画面に残す高さ。地図側の現在地ボタンの位置もこれに合わせる。 */
export const PEEK_PX = 152;

/**
 * 下からせり上がるシート。Google マップの下部パネルと同じ操作感を狙って、
 * 3段階のスナップ + ドラッグ + グリップのタップで切り替えられるようにしている。
 */
export class Sheet {
  readonly head: HTMLElement;
  readonly body: HTMLElement;
  private root: HTMLElement;
  private snap: SheetSnap = 'peek';
  private dragStartY = 0;
  private dragStartOffset = 0;
  private dragging = false;
  onSnapChange?: (snap: SheetSnap) => void;

  constructor(root: HTMLElement, grip: HTMLElement, head: HTMLElement, body: HTMLElement) {
    this.root = root;
    this.head = head;
    this.body = body;

    grip.addEventListener('pointerdown', (e) => this.onDown(e, grip));
    grip.addEventListener('pointermove', (e) => this.onMove(e));
    grip.addEventListener('pointerup', (e) => this.onUp(e, grip));
    grip.addEventListener('pointercancel', (e) => this.onUp(e, grip));

    window.addEventListener('resize', () => this.apply());
    this.apply();
  }

  private get height(): number {
    return this.root.offsetHeight || window.innerHeight * 0.88;
  }

  private offsetFor(snap: SheetSnap): number {
    switch (snap) {
      case 'full':
        return 0;
      case 'half':
        return Math.round(this.height * 0.48);
      case 'peek':
        return Math.max(this.height - PEEK_PX, 0);
    }
  }

  setSnap(snap: SheetSnap): void {
    if (this.snap === snap) return;
    this.snap = snap;
    this.apply();
    this.onSnapChange?.(snap);
  }

  get current(): SheetSnap {
    return this.snap;
  }

  /** 一覧から詳細に移るときなど、閉じすぎていたら少し持ち上げる。 */
  raiseAtLeast(snap: SheetSnap): void {
    const order: SheetSnap[] = ['peek', 'half', 'full'];
    if (order.indexOf(this.snap) < order.indexOf(snap)) this.setSnap(snap);
  }

  private apply(): void {
    const offset = this.offsetFor(this.snap);
    this.root.style.setProperty('--sheet-offset', `${offset}px`);
    // 地図側のUI（現在地ボタン・帰属表示）を、シートに隠れない位置へ追従させる
    const visible = this.height - offset;
    document.documentElement.style.setProperty(
      '--sheet-peek',
      `${Math.min(visible, window.innerHeight * 0.55)}px`,
    );
    this.body.scrollTop = this.snap === 'peek' ? 0 : this.body.scrollTop;
  }

  private onDown(e: PointerEvent, grip: HTMLElement): void {
    this.dragging = true;
    this.dragStartY = e.clientY;
    this.dragStartOffset = this.offsetFor(this.snap);
    this.root.classList.add('is-dragging');
    grip.setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent): void {
    if (!this.dragging) return;
    const delta = e.clientY - this.dragStartY;
    const offset = Math.min(Math.max(this.dragStartOffset + delta, 0), this.offsetFor('peek'));
    this.root.style.setProperty('--sheet-offset', `${offset}px`);
  }

  private onUp(e: PointerEvent, grip: HTMLElement): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.root.classList.remove('is-dragging');
    if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);

    const delta = e.clientY - this.dragStartY;
    // ほとんど動かなかった場合はタップとみなし、次の段階へ送る
    if (Math.abs(delta) < 6) {
      const next: Record<SheetSnap, SheetSnap> = { peek: 'half', half: 'full', full: 'peek' };
      this.snap = next[this.snap];
      this.apply();
      this.onSnapChange?.(this.snap);
      return;
    }

    const offset = Math.min(Math.max(this.dragStartOffset + delta, 0), this.offsetFor('peek'));
    const candidates: SheetSnap[] = ['full', 'half', 'peek'];
    let best = candidates[0];
    let bestDist = Infinity;
    for (const c of candidates) {
      const d = Math.abs(this.offsetFor(c) - offset);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    this.snap = best;
    this.apply();
    this.onSnapChange?.(best);
  }
}
