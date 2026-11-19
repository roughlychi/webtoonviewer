/*
  스크롤과 확대·축소를 맡는다.

  열의 스크롤 위치는 두 값의 합으로 정한다.
    position = clamp(shared + offset, 0, max)
  shared는 모든 열이 같이 쓰는 공통 위치, offset은 열마다 맞춰 둔 어긋남이다.
  position만 저장하면 한 열이 끝에 닿아 멈출 때 어긋남이 사라지지만,
  shared와 offset을 따로 두면 끝에서 돌아올 때 맞춰 둔 정렬이 그대로 살아난다.
  max는 그 열이 스크롤할 수 있는 최대 높이(px)다.

  위쪽 "계산" 부분은 화면을 모르는 순수 함수라서 테스트로 지킨다.
  아래 "화면 반영" 부분이 휠 입력을 받아 계산 결과를 화면에 적용한다.
*/
import { state, MIN_COLUMN_WIDTH, findColumn, setZoom } from './state.js';

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

const WHEEL_NOTCH_THRESHOLD = 50; // 이 값 이상이면 마우스 휠 한 칸으로 본다 (트랙패드는 훨씬 작다)
const WHEEL_NOTCH_SCALE = 0.5; // 마우스 휠 한 칸의 이동량 배율
const WHEEL_LINE_PX = 16; // 휠이 "줄" 단위로 올 때 한 줄의 높이(px)
const ZOOM_SPEED = 0.0015; // Ctrl+휠의 확대·축소 속도
const SYNC_TOLERANCE_PX = 2; // 이 정도 차이는 계산 오차로 본다
const ZOOM_EPSILON = 1e-4;

// ---------------------------------------------------------------- 계산

export const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

export const position = (shared, { offset, max }) => clamp(shared + offset, 0, max);

// 공통 위치가 움직일 수 있는 범위. 모든 열이 끝에 닿은 뒤로는 더 움직일 필요가 없다.
// 스크롤할 수 없는 열(max가 0)은 계산에서 뺀다. 스크롤할 열이 없으면 null.
export function sharedRange(columns) {
  const scrollable = columns.filter((column) => column.max > 0);
  if (!scrollable.length) return null;
  return {
    lo: 0 - Math.max(...scrollable.map((column) => column.offset)), // -0이 나오지 않게 0에서 뺀다
    hi: Math.max(...scrollable.map((column) => column.max - column.offset)),
  };
}

export function clampShared(shared, columns) {
  const range = sharedRange(columns);
  return range ? clamp(shared, range.lo, range.hi) : shared;
}

// 모든 열을 amount만큼 같이 움직였을 때의 공통 위치
export function scrollShared(shared, amount, columns) {
  return clampShared(shared + amount, columns);
}

// 한 열만 amount만큼 움직였을 때의 offset. 지금 눈에 보이는 위치에서 출발한다.
export function shiftedOffset(shared, column, amount) {
  return clamp(position(shared, column) + amount, 0, column.max) - shared;
}

// 열 너비가 factor배로 바뀌었을 때 저장된 위치. anchor(열 위쪽에서 제자리에 둘 지점의 높이)가
// 제자리에 남도록 공통 위치를 더 보정한다.
export function rescaled(shared, offsets, factor, anchor = 0) {
  return {
    shared: shared * factor + anchor * (factor - 1),
    offsets: offsets.map((offset) => offset * factor),
  };
}

// 스크롤바 드래그 등으로 열이 직접 움직였을 때 새 offset. 오차 범위 안이면 null.
export function syncedOffset(shared, column, scrollTop) {
  const moved = Math.abs(scrollTop - position(shared, column)) > SYNC_TOLERANCE_PX;
  return moved ? scrollTop - shared : null;
}

// 휠 한 번에 움직일 픽셀. Shift를 누르면 브라우저가 위아래 휠을 deltaX로 바꿔 보내는 경우가 있다.
export function wheelPixels({ deltaX, deltaY, deltaMode, shiftKey }, pageHeight) {
  let amount = shiftKey ? deltaY || deltaX : deltaY;
  if (deltaMode === 1) amount *= WHEEL_LINE_PX;
  else if (deltaMode === 2) amount *= pageHeight;
  return Math.abs(amount) >= WHEEL_NOTCH_THRESHOLD ? amount * WHEEL_NOTCH_SCALE : amount;
}

// 열 하나가 minColumnWidth보다 좁아지지 않는 가장 작은 확대 비율
export const zoomFloor = (viewerWidth, columnCount, minColumnWidth) =>
  Math.max(MIN_ZOOM, minColumnWidth / (viewerWidth / columnCount));

// 열이 최소 너비에 걸려 있으면 저장된 값보다 클 수 있다
export const effectiveZoom = (zoom, floor) => Math.max(zoom, floor);

export const clampZoom = (zoom, floor) => clamp(zoom, floor, MAX_ZOOM);

export const sameZoom = (a, b) => Math.abs(a - b) < ZOOM_EPSILON;

export function nextZoom(current, { deltaY, deltaMode }, floor) {
  const delta = deltaMode === 1 ? deltaY * WHEEL_LINE_PX : deltaY;
  return clampZoom(current * Math.exp(-delta * ZOOM_SPEED), floor);
}

// ---------------------------------------------------------------- 화면 반영

let viewer;
let shared = 0; // 모든 열이 같이 쓰는 공통 위치
const offsets = new Map(); // 열 번호표 -> 그 열의 offset
let lastWidth = 0;
let pendingAnchor = 0; // 다음 열 너비 변경 때 제자리에 둘 지점의 높이 (확대·축소가 지정)
let applyQueued = false;

const offsetOf = (id) => offsets.get(id) ?? 0;
const maxScroll = (body) => Math.max(0, body.scrollHeight - body.clientHeight);

export const boxOf = (id) => viewer.querySelector(`.column[data-id="${id}"]`);
const bodyOf = (id) => boxOf(id)?.querySelector('.column-body') ?? null;

// 계산 부분이 쓰는 모양으로 각 열의 현재 상태를 잰다
const measure = () =>
  state.columns.map(({ id }) => {
    const body = bodyOf(id);
    return { id, offset: offsetOf(id), body, max: body ? maxScroll(body) : 0 };
  });

function apply() {
  for (const column of measure()) {
    if (column.body) column.body.scrollTop = position(shared, column);
  }
}

// 이미지가 올라올 때마다 길이가 바뀌므로, 장수만큼 반복하지 않고 프레임당 한 번만 맞춘다
export function applySoon() {
  if (applyQueued) return;
  applyQueued = true;
  requestAnimationFrame(() => {
    applyQueued = false;
    apply();
  });
}

// 열 너비가 바뀌면 이미지 높이도 같은 비율로 바뀌므로 저장된 위치를 같은 비율로 바꾼다
function rescale() {
  const first = boxOf(state.columns[0].id);
  const width = first ? first.getBoundingClientRect().width : 0;
  if (lastWidth && width && width !== lastWidth) {
    const ids = state.columns.map((column) => column.id);
    const next = rescaled(shared, ids.map(offsetOf), width / lastWidth, pendingAnchor);
    shared = next.shared;
    ids.forEach((id, i) => offsets.set(id, next.offsets[i]));
  }
  if (width) lastWidth = width;
  pendingAnchor = 0;
}

// 열 구성이 바뀐 뒤에 부른다
export function refresh() {
  for (const id of offsets.keys()) {
    if (!findColumn(id)) offsets.delete(id);
  }
  rescale();
  shared = clampShared(shared, measure());
  apply();
}

// 새 이미지가 들어온 열은 맨 위부터 보이게 한다
export function resetColumn(id) {
  offsets.set(id, -shared);
}

// 스크롤바 드래그 등으로 한 열만 움직였을 때 그 열의 offset으로 기록한다
export function sync(id, body) {
  const column = { offset: offsetOf(id), max: maxScroll(body) };
  const next = syncedOffset(shared, column, body.scrollTop);
  if (next !== null) offsets.set(id, next);
}

export function toTop() {
  const range = sharedRange(measure());
  shared = range ? range.lo : 0;
  apply();
}

export function toBottom() {
  const range = sharedRange(measure());
  if (range) shared = range.hi;
  apply();
}

const floor = () => zoomFloor(viewer.clientWidth, state.columns.length, MIN_COLUMN_WIDTH);

export const currentZoom = () => effectiveZoom(state.zoom, floor());

// (anchorX, anchorY)는 확대·축소해도 화면에서 제자리에 있어야 하는 점
function zoomAt(next, anchorX, anchorY) {
  const old = currentZoom();
  const target = clampZoom(next, floor());
  if (sameZoom(target, old)) return;
  const factor = target / old;

  const firstId = state.columns[0].id;
  const first = boxOf(firstId);
  const fromFirst = anchorX - first.getBoundingClientRect().left;
  pendingAnchor = anchorY - bodyOf(firstId).getBoundingClientRect().top;

  setZoom(target);
  viewer.scrollLeft += first.getBoundingClientRect().left + fromFirst * factor - anchorX;
}

export function resetZoom() {
  const area = viewer.getBoundingClientRect();
  zoomAt(1, area.left + area.width / 2, area.top + area.height / 2);
}

function onWheel(event) {
  if (event.ctrlKey) {
    event.preventDefault();
    zoomAt(nextZoom(currentZoom(), event, floor()), event.clientX, event.clientY);
    return;
  }

  const box = event.target.closest?.('.column');
  if (!box || (!event.shiftKey && event.deltaY === 0)) return;
  event.preventDefault();

  const columns = measure();
  const column = columns.find((item) => String(item.id) === box.dataset.id);
  const amount = wheelPixels(event, column.body.clientHeight);
  if (event.shiftKey) offsets.set(column.id, shiftedOffset(shared, column, amount));
  else shared = scrollShared(shared, amount, columns);
  apply();
}

export function initScroll() {
  viewer = document.getElementById('viewer');
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', refresh);
}
