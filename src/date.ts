import type { EventItem } from './types';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 日付キーは常に日本時間の 'YYYY-MM-DD'。
 * 端末のタイムゾーンに引きずられて「今日」がずれるのを防ぐため、
 * アプリ内の日付比較はすべてこのキーを経由する。
 */
export type DayKey = string;

export function toDayKey(input: string | number | Date): DayKey {
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime();
  return new Date(t + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function todayKey(): DayKey {
  return toDayKey(Date.now());
}

export function addDays(key: DayKey, days: number): DayKey {
  const t = Date.parse(`${key}T00:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function diffDays(from: DayKey, to: DayKey): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** 今日から days 日分の日付キー配列。日付ストリップの元データ。 */
export function dayKeyRange(days: number, start: DayKey = todayKey()): DayKey[] {
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const;

export function weekdayOf(key: DayKey): (typeof WEEKDAY_JA)[number] {
  const d = new Date(`${key}T00:00:00Z`).getUTCDay();
  return WEEKDAY_JA[d];
}

export function isWeekend(key: DayKey): boolean {
  const d = new Date(`${key}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

/** 日付ストリップ用の短い表記。「9/4」など。 */
export function shortLabel(key: DayKey): string {
  const [, m, d] = key.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export function longLabel(key: DayKey): string {
  const [y, m, d] = key.split('-');
  return `${y}年${Number(m)}月${Number(d)}日(${weekdayOf(key)})`;
}

export function relativeLabel(key: DayKey): string | null {
  const n = diffDays(todayKey(), key);
  if (n === 0) return '今日';
  if (n === 1) return '明日';
  if (n === 2) return '明後日';
  return null;
}

/** イベントが占める日付キーの範囲を [開始, 終了] で返す。 */
export function eventDayRange(ev: EventItem): [DayKey, DayKey] {
  const start = toDayKey(ev.startAt);
  const end = ev.endAt ? toDayKey(ev.endAt) : start;
  // 終了が開始より前になっている壊れたデータは、開始日だけの単日扱いに寄せる
  return end < start ? [start, start] : [start, end];
}

/** その日にやっているか。複数日開催のフェスは期間中どの日でも true。 */
export function occursOn(ev: EventItem, key: DayKey): boolean {
  const [start, end] = eventDayRange(ev);
  return start <= key && key <= end;
}

export function isMultiDay(ev: EventItem): boolean {
  const [start, end] = eventDayRange(ev);
  return start !== end;
}

function timeOfDay(iso: string): string {
  const d = new Date(new Date(iso).getTime() + JST_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * 選択中の日付から見た開催時間の表示。
 * 複数日開催の中日は「終日」、初日/最終日は片側だけ時刻を出す。
 */
export function timeLabelFor(ev: EventItem, key: DayKey): string {
  if (ev.allDay) return '終日';
  const [start, end] = eventDayRange(ev);
  const isFirst = key === start;
  const isLast = key === end;

  if (isFirst && isLast) {
    const s = timeOfDay(ev.startAt);
    if (!ev.endAt) return `${s}〜`;
    return `${s}〜${timeOfDay(ev.endAt)}`;
  }
  if (isFirst) return `${timeOfDay(ev.startAt)}〜`;
  if (isLast && ev.endAt) return `〜${timeOfDay(ev.endAt)}`;
  return '終日';
}

/** 「9/4(木)〜9/7(日)」のような開催期間表記。 */
export function periodLabel(ev: EventItem): string {
  const [start, end] = eventDayRange(ev);
  const fmt = (k: DayKey) => `${shortLabel(k)}(${weekdayOf(k)})`;
  return start === end ? fmt(start) : `${fmt(start)}〜${fmt(end)}`;
}
