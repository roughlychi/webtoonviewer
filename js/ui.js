import {
  state,
  MAX_COLUMNS,
  MIN_COLUMN_WIDTH,
  findColumn,
  setImages,
  addColumn,
  removeColumn,
  moveColumn,
  toggleTheme,
} from './state.js';
import {
  boxOf,
  refresh,
  applySoon,
  resetColumn,
  sync,
  toTop,
  toBottom,
  resetZoom,
  currentZoom,
} from './scroll.js';

const viewer = document.getElementById('viewer');
const toolbar = document.getElementById('toolbar');
const dropLine = document.getElementById('drop-line');
const tip = document.getElementById('filename-tip');
const fileInput = document.getElementById('file-input');

const IMAGE_NAME = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

const NOTICE_MS = 4000; // 알림 띠가 떠 있는 시간
const TIP_OFFSET_X = 14; // 파일명 표시와 마우스 사이 간격
const TIP_OFFSET_Y = 18;
const TIP_MARGIN = 8; // 화면 가장자리에서 이만큼 떨어지면 반대쪽으로 넘긴다
const TIP_MIN_EDGE = 4;

const parts = new WeakMap(); // 열 상자 -> 바뀌는 부분들
let addButton;
let zoomButton;
let themeButton;
let shownTheme;
let draggingId = null;
let dropAt = null; // 놓으면 들어갈 경계 번호 (0 = 맨 왼쪽, 열 수 = 맨 오른쪽)
let pointer = { x: 0, y: 0 };
let tipQueued = false;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const button = (label, onClick, className) => {
  const node = el('button', className, label);
  node.type = 'button';
  node.onclick = onClick;
  return node;
};

// 아이콘 그림은 index.html의 <template>에 있다
const icon = (name) => document.getElementById(`icon-${name}`).content.cloneNode(true);

const iconButton = (name, label, onClick, className = '') => {
  const node = button('', onClick, `icon-button ${className}`.trim());
  node.title = label;
  node.setAttribute('aria-label', label);
  node.append(icon(name));
  return node;
};

const toImages = (files) =>
  [...files]
    .filter((file) => file.type.startsWith('image/') || IMAGE_NAME.test(file.name))
    .sort((a, b) => collator.compare(a.name, b.name))
    .map((file) => ({ name: file.name, url: URL.createObjectURL(file) }));

function pickImages(columnId) {
  fileInput.value = '';
  fileInput.onchange = () => {
    const images = toImages(fileInput.files);
    if (images.length) setImages(columnId, images);
    else showNotice(columnId);
  };
  fileInput.click();
}

function showNotice(id) {
  const box = boxOf(id);
  const part = parts.get(box);
  part.notice.classList.add('show');
  clearTimeout(part.timer);
  part.timer = setTimeout(() => hideNotice(box), NOTICE_MS);
  applySoon();
}

function hideNotice(box) {
  const part = parts.get(box);
  clearTimeout(part.timer);
  part.notice.classList.remove('show');
  applySoon();
}

// 열 사이 경계의 x좌표: 맨 왼쪽, 열과 열 사이마다, 맨 오른쪽
function boundaries() {
  const rects = state.columns.map((column) => boxOf(column.id).getBoundingClientRect());
  return [...rects.map((rect) => rect.left), rects.at(-1).right];
}

function showLine(index) {
  const area = viewer.getBoundingClientRect();
  dropLine.style.display = 'block';
  const width = dropLine.offsetWidth;
  const x = boundaries()[index] - width / 2;
  Object.assign(dropLine.style, {
    left: `${Math.min(Math.max(x, 0), window.innerWidth - width)}px`,
    top: `${area.top}px`,
    height: `${area.height}px`,
  });
}

function hideLine() {
  dropLine.style.display = 'none';
  dropAt = null;
}

function endDrag() {
  if (draggingId !== null) boxOf(draggingId)?.classList.remove('dragging');
  draggingId = null;
  hideLine();
}

function onDragOver(event) {
  if (draggingId === null) return;
  event.preventDefault();
  const xs = boundaries();
  let best = 0;
  xs.forEach((x, i) => {
    if (Math.abs(event.clientX - x) < Math.abs(event.clientX - xs[best])) best = i;
  });
  const from = state.columns.indexOf(findColumn(draggingId));
  if (best === from || best === from + 1)
    hideLine(); // 원래 자리라 옮겨지지 않는다
  else {
    dropAt = best;
    showLine(best);
  }
}

function onDrop(event) {
  if (draggingId === null) return;
  event.preventDefault();
  const id = draggingId;
  const at = dropAt;
  endDrag();
  if (at !== null) moveColumn(id, at);
}

function buildColumn({ id }) {
  const box = el('section', 'column');
  box.dataset.id = id;

  const handle = el('span', 'column-handle');
  handle.append(icon('grip'));
  handle.title = '끌어서 열 위치 바꾸기';
  handle.draggable = true;
  const title = el('span', 'column-title');
  const closeButton = iconButton('x', '열 닫기', () => removeColumn(id));
  const header = el('div', 'column-header');
  header.append(
    handle,
    title,
    iconButton('photo-plus', '파일 선택', () => pickImages(id)),
    closeButton,
  );

  const notice = el('div', 'notice');
  notice.append(icon('warning'), el('span', '', '이미지 파일이 없어요.'));
  notice.onclick = () => hideNotice(box);

  box.append(header, notice, el('div', 'column-body'));
  parts.set(box, { title, closeButton, notice, timer: null, shown: null });

  handle.addEventListener('dragstart', (event) => {
    draggingId = id;
    event.dataTransfer.setData('text/x-column-id', String(id)); // Firefox는 데이터가 있어야 끌기가 시작된다
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setDragImage(header, 20, 20);
    setTimeout(() => box.classList.add('dragging'), 0); // 끌기 그림을 찍은 뒤에 흐리게 한다
  });
  handle.addEventListener('dragend', endDrag);
  return box;
}

function brokenBox(name) {
  const box = el('div', 'broken');
  box.dataset.name = name;
  box.append(icon('broken'));
  return box;
}

function fillBody(box, { id, images }) {
  const body = el('div', 'column-body');
  if (!images.length) {
    body.append(el('p', 'empty-hint', '위쪽의 사진 추가 아이콘으로 이미지를 불러오세요.'));
  }
  for (const { name, url } of images) {
    const img = el('img');
    img.alt = name;
    img.dataset.name = name;
    img.decoding = 'async';
    img.addEventListener('load', applySoon);
    img.addEventListener('error', () => {
      img.replaceWith(brokenBox(name));
      applySoon();
    });
    img.src = url;
    body.append(img);
  }
  body.addEventListener('scroll', () => sync(id, body));
  box.querySelector('.column-body').replaceWith(body);
  parts.get(box).shown = images;
  resetColumn(id);
}

export function render() {
  const { columns } = state;
  viewer.style.setProperty('--count', columns.length);
  viewer.style.setProperty('--zoom', state.zoom);
  viewer.style.setProperty('--min-column', `${MIN_COLUMN_WIDTH}px`);

  for (const box of viewer.querySelectorAll('.column')) {
    if (!columns.some((column) => String(column.id) === box.dataset.id)) box.remove();
  }
  columns.forEach((column, index) => {
    let box = boxOf(column.id);
    if (!box) {
      box = buildColumn(column);
      viewer.append(box);
    }
    const part = parts.get(box);
    if (part.shown !== column.images) fillBody(box, column);
    box.style.order = index; // 열을 옮길 때 상자는 그대로 두고 보이는 순서만 바꾼다
    part.title.textContent = `${index + 1}열`;
    part.closeButton.disabled = columns.length === 1;
  });

  addButton.disabled = columns.length >= MAX_COLUMNS;
  zoomButton.textContent = `${Math.round(currentZoom() * 100)}%`;
  if (shownTheme !== state.theme) {
    shownTheme = state.theme;
    const dark = state.theme === 'dark';
    document.documentElement.dataset.theme = state.theme;
    themeButton.replaceChildren(icon(dark ? 'sun' : 'moon'));
    themeButton.title = dark ? '밝은 화면으로' : '어두운 화면으로';
    themeButton.setAttribute('aria-label', themeButton.title);
  }
  refresh();
}

// 파일명 표시: 마우스 옆에 작게. 스크롤 중에는 마우스가 가만히 있어도 아래 이미지가 바뀐다
function updateTip() {
  tipQueued = false;
  const under = document.elementFromPoint(pointer.x, pointer.y);
  const name = under && viewer.contains(under) ? under.closest('[data-name]')?.dataset.name : null;
  if (!name) {
    tip.style.display = 'none';
    return;
  }
  if (tip.textContent !== name) tip.textContent = name;
  tip.style.display = 'block';
  let left = pointer.x + TIP_OFFSET_X;
  let top = pointer.y + TIP_OFFSET_Y;
  if (left + tip.offsetWidth > window.innerWidth - TIP_MARGIN) {
    left = pointer.x - tip.offsetWidth - TIP_OFFSET_X;
  }
  if (top + tip.offsetHeight > window.innerHeight - TIP_MARGIN) {
    top = pointer.y - tip.offsetHeight - TIP_OFFSET_X;
  }
  tip.style.left = `${Math.max(TIP_MIN_EDGE, left)}px`;
  tip.style.top = `${Math.max(TIP_MIN_EDGE, top)}px`;
}

function scheduleTip() {
  if (tipQueued) return;
  tipQueued = true;
  requestAnimationFrame(updateTip);
}

const hideTip = () => {
  tip.style.display = 'none';
};

export function initUi() {
  addButton = iconButton('plus', '열 추가', addColumn);
  zoomButton = button('', resetZoom, 'icon-button chip push-right');
  zoomButton.title = '누르면 100%로 돌아갑니다';
  themeButton = iconButton('moon', '다크 모드', toggleTheme);
  toolbar.append(
    addButton,
    zoomButton,
    iconButton('up', '맨 위로', toTop),
    iconButton('down', '맨 아래로', toBottom),
    themeButton,
  );

  viewer.addEventListener('dragover', onDragOver);
  viewer.addEventListener('drop', onDrop);

  viewer.addEventListener('mousemove', (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    scheduleTip();
  });
  viewer.addEventListener('mouseleave', hideTip);
  viewer.addEventListener('scroll', scheduleTip, true); // scroll은 위로 전달되지 않아 capture로 받는다
  document.addEventListener('dragstart', hideTip);

  // 파일을 화면에 실수로 놓아도 브라우저가 이미지를 새 화면으로 열지 않게 한다
  for (const type of ['dragover', 'drop']) {
    window.addEventListener(type, (event) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    });
  }
}
