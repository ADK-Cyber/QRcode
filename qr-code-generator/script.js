// The page uses the encoder's real module grid, then draws those modules on canvas.
const form = document.querySelector('#qr-form');
const textInput = document.querySelector('#text-input');
const eccSelect = document.querySelector('#ecc-select');
const versionSelect = document.querySelector('#version-select');
const maskSelect = document.querySelector('#mask-select');
const errorMessage = document.querySelector('#error-message');
const downloadButton = document.querySelector('#download-button');
const clearButton = document.querySelector('#clear-button');
const standardCanvas = document.querySelector('#standard-canvas');
const experimentCanvas = document.querySelector('#experiment-canvas');
const maskStageCanvas = document.querySelector('#mask-stage-canvas');
const themeToggle = document.querySelector('#theme-toggle');
const standardMeta = document.querySelector('#standard-meta');
const experimentMeta = document.querySelector('#experiment-meta');
const codeSummary = document.querySelector('#code-summary');
const partExplanation = document.querySelector('#part-explanation');

const partDescriptions = {
  all: 'The QR grid contains functional patterns and a stream of data and error-correction bits. Four blank modules around the grid form its quiet zone.',
  finder: 'The three large corner squares help a scanner find the symbol, its orientation, and its size. The one-module white separators keep them distinct from nearby data.',
  timing: 'The alternating row and column between the finders help the scanner determine the grid spacing.',
  alignment: 'Smaller bullseye patterns help correct perspective distortion. Their number and positions depend on the QR version.',
  format: 'Two copies encode the error-correction level and mask number. They have their own error protection, so a scanner can learn how to read the rest.',
  version: 'Versions 7 through 40 include two copies of version information. Versions 1 through 6 do not need these extra bits.',
  data: 'Data codewords carry the encoded input, mode and length fields, and padding. Their modules are interleaved with error-correction codewords.',
  ecc: 'Reed–Solomon error-correction codewords let a scanner recover from some damaged or obscured parts. They are interleaved with data codewords.',
  remainder: 'If the available data area does not end on a full byte, the remaining modules are remainder bits. They are masked like the other data-area modules.'
};

const maskDescriptions = [
  '(x + y) mod 2 = 0',
  'y mod 2 = 0',
  'x mod 3 = 0',
  '(x + y) mod 3 = 0',
  '(floor(x / 3) + floor(y / 2)) mod 2 = 0',
  '(x × y mod 2 + x × y mod 3) = 0',
  '(x × y mod 2 + x × y mod 3) mod 2 = 0',
  '((x + y) mod 2 + x × y mod 3) mod 2 = 0'
];

const lessonSteps = [
  {
    title: '1. Encode the input',
    description: 'The encoder chooses a compact mode for your text: numeric for digits, alphanumeric for a supported uppercase character set, or byte mode for general UTF-8 text.',
    detail: ''
  },
  {
    title: '2. Add error correction',
    description: 'The encoder turns data into codewords and calculates Reed–Solomon error-correction codewords. The codewords are split into blocks and interleaved so a damaged area is less likely to destroy one whole sequence.',
    detail: ''
  },
  {
    title: '3. Place codewords in the grid',
    description: 'The encoder places data and error-correction bits in a zigzag path through the open modules. Functional patterns reserve some modules first.',
    detail: ''
  },
  {
    title: '4. Apply a mask',
    description: 'A mask flips selected data-area modules using a repeating mathematical rule. The standard encoder tries all eight patterns and chooses the one with the lowest penalty score; the experiment preview can force a particular pattern.',
    detail: ''
  },
  {
    title: '5. Add the locating information',
    description: 'Finder, separator, timing, alignment, format, and (for version 7+) version-information modules help a scanner locate and interpret the symbol. A four-module quiet zone stays white around the outside.',
    detail: ''
  }
];

let standardQr = null;
let experimentQr = null;
let standardParts = null;
let experimentParts = null;
let unmaskedGrid = null;
let maskStage = 'before';
let selectedPart = 'all';
let hoveredPart = null;
let lessonIndex = 0;

applyTheme(readSavedTheme());

// Fill the version menu once. Version 1 is 21 by 21; each later version adds 4.
for (let version = 1; version <= 40; version += 1) {
  const option = document.createElement('option');
  option.value = String(version);
  option.textContent = `Version ${version} (${version * 4 + 17} × ${version * 4 + 17} modules)`;
  versionSelect.append(option);
}

form.addEventListener('submit', function (event) {
  event.preventDefault();
  generateQrCodes();
});

themeToggle.addEventListener('click', function () {
  const nextTheme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
  try {
    localStorage.setItem('qr-explorer-theme', nextTheme);
  } catch (error) {
    // The theme still changes for this visit if browser storage is unavailable.
  }
});

downloadButton.addEventListener('click', downloadExperiment);
clearButton.addEventListener('click', clearPage);
document.querySelectorAll('[data-part]').forEach(function (button) {
  button.addEventListener('pointerenter', function () { setHoveredPart(button.dataset.part); });
  button.addEventListener('pointerleave', function () { setHoveredPart(null); });
  button.addEventListener('focus', function () { setHoveredPart(button.dataset.part); });
  button.addEventListener('blur', function () { setHoveredPart(null); });
  button.addEventListener('click', function () { selectPart(button.dataset.part); });
});

document.querySelector('#previous-step').addEventListener('click', function () {
  showLessonStep(lessonIndex - 1);
});
document.querySelector('#next-step').addEventListener('click', function () {
  showLessonStep(lessonIndex + 1);
});
document.querySelector('#show-unmasked').addEventListener('click', function () {
  setMaskStage('before');
});
document.querySelector('#show-masked').addEventListener('click', function () {
  setMaskStage('after');
});

function readSavedTheme() {
  try {
    return localStorage.getItem('qr-explorer-theme') === 'dark' ? 'dark' : 'light';
  } catch (error) {
    return 'light';
  }
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.body.dataset.theme = isDark ? 'dark' : 'light';
  themeToggle.setAttribute('aria-pressed', String(isDark));
  themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  themeToggle.textContent = isDark ? 'Light mode' : 'Dark mode';
}

function generateQrCodes() {
  const text = textInput.value.trim();
  errorMessage.textContent = '';

  if (text === '') {
    errorMessage.textContent = 'Please enter some text or a URL first.';
    textInput.focus();
    return;
  }

  if (typeof qrcodegen === 'undefined') {
    errorMessage.textContent = 'The QR encoder could not load. Check your internet connection and reload this page.';
    return;
  }

  try {
    const QrCode = qrcodegen.QrCode;
    const QrSegment = qrcodegen.QrSegment;
    const ecc = getErrorCorrectionLevel(eccSelect.value);
    const requestedVersion = versionSelect.value;
    const minVersion = requestedVersion === 'auto' ? QrCode.MIN_VERSION : Number(requestedVersion);
    const maxVersion = requestedVersion === 'auto' ? QrCode.MAX_VERSION : Number(requestedVersion);
    const segments = QrSegment.makeSegments(text);

    // A mask of -1 means the encoder evaluates all eight masks automatically.
    standardQr = QrCode.encodeSegments(segments, ecc, minVersion, maxVersion, -1, false);
    const requestedMask = maskSelect.value === 'auto' ? -1 : Number(maskSelect.value);
    experimentQr = QrCode.encodeSegments(segments, ecc, minVersion, maxVersion, requestedMask, false);

    // Mask 0 is a convenient reversible baseline. Undoing it on the data area
    // gives the exact pre-mask grid while retaining the encoder's real code bits.
    const preMaskQr = QrCode.encodeSegments(segments, ecc, minVersion, maxVersion, 0, false);

    // Build an accurate module-to-part map for the lesson outlines.
    standardParts = classifyModules(standardQr);
    experimentParts = classifyModules(experimentQr);
    unmaskedGrid = makeUnmaskedGrid(preMaskQr, classifyModules(preMaskQr), 0);
    maskStage = 'before';
    drawAllPreviews();
    updateMaskStage();
    updateSummary(text, segments[0]);
    updateMetadata();
    downloadButton.disabled = false;
    errorMessage.textContent = '';
  } catch (error) {
    clearGeneratedCodes();
    if (versionSelect.value !== 'auto') {
      errorMessage.textContent = `This text does not fit in version ${versionSelect.value} at error-correction level ${eccSelect.value}. Choose a higher version, a lower correction level, or Automatic.`;
    } else {
      errorMessage.textContent = 'This text is too long for a QR code. Shorten it or use a lower error-correction level.';
    }
    console.error('QR generation failed:', error);
  }
}

function getErrorCorrectionLevel(level) {
  const levels = {
    L: qrcodegen.QrCode.Ecc.LOW,
    M: qrcodegen.QrCode.Ecc.MEDIUM,
    Q: qrcodegen.QrCode.Ecc.QUARTILE,
    H: qrcodegen.QrCode.Ecc.HIGH
  };
  return levels[level];
}

function updateSummary(text, segment) {
  const modeName = getModeName(segment.mode.modeBits);
  const size = standardQr.size;
  const versionText = versionSelect.value === 'auto' ? `Version ${standardQr.version} selected automatically` : `Fixed version ${standardQr.version}`;
  codeSummary.textContent = `${versionText} · ${size} × ${size} modules · ECC ${eccSelect.value} · standard mask ${standardQr.mask} · experiment mask ${experimentQr.mask} · ${modeName} mode`;

  lessonSteps[0].detail = `This input uses ${modeName} mode (${Array.from(text).length} characters, ${new TextEncoder().encode(text).length} UTF-8 bytes).`;
  lessonSteps[1].detail = `The selected level is ${eccSelect.value}. Its module map contains ${countPart(standardParts, 'data')} data modules and ${countPart(standardParts, 'ecc')} error-correction modules.`;
  lessonSteps[2].detail = `Version ${standardQr.version} has a ${size} × ${size} grid. The grid contains ${countPart(standardParts, 'remainder')} remainder-bit modules after complete codewords are placed.`;
  lessonSteps[3].detail = `The standard preview selected mask ${standardQr.mask} (${maskDescriptions[standardQr.mask]}). The experiment preview uses mask ${experimentQr.mask} (${maskDescriptions[experimentQr.mask]}).`;
  lessonSteps[4].detail = `This symbol has ${countPart(standardParts, 'finder')} finder/separator modules, ${countPart(standardParts, 'timing')} timing modules, and ${countPart(standardParts, 'alignment')} alignment modules.`;
  showLessonStep(lessonIndex);
}

function getModeName(modeBits) {
  if (modeBits === 1) return 'Numeric';
  if (modeBits === 2) return 'Alphanumeric';
  return 'Byte';
}

function updateMetadata() {
  standardMeta.textContent = `Version ${standardQr.version} · ECC ${eccSelect.value} · automatic mask ${standardQr.mask}`;
  experimentMeta.textContent = `Version ${experimentQr.version} · ECC ${eccSelect.value} · mask ${experimentQr.mask}`;
}

function drawAllPreviews() {
  if (!standardQr || !experimentQr) return;
  const part = hoveredPart || selectedPart;
  drawQr(standardCanvas, standardQr, standardParts, part, true);
  drawQr(experimentCanvas, experimentQr, experimentParts, part, true);
  updateMaskStage();
}

function drawQr(canvas, qr, partMap, highlightedPart, showQuietZone, moduleGrid) {
  const moduleScale = 4;
  const border = showQuietZone ? 4 : 0;
  const totalSize = (qr.size + border * 2) * moduleScale;
  canvas.width = totalSize;
  canvas.height = totalSize;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, totalSize, totalSize);

  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      const left = (x + border) * moduleScale;
      const top = (y + border) * moduleScale;
      const isDark = moduleGrid ? moduleGrid[y][x] : qr.getModule(x, y);
      if (isDark) {
        context.fillStyle = '#000';
        context.fillRect(left, top, moduleScale, moduleScale);
      }

      if (highlightedPart !== 'all' && partMap[y][x] === highlightedPart) {
        // Opposite-color outlines keep selected modules visible in monochrome.
        context.strokeStyle = isDark ? '#fff' : '#000';
        context.lineWidth = 1;
        context.strokeRect(left + 0.5, top + 0.5, moduleScale - 1, moduleScale - 1);
      }
    }
  }
  canvas.setAttribute('aria-label', `${qr.version === 1 ? 'Version 1' : `Version ${qr.version}`} QR code, error correction ${eccSelect.value}, mask ${qr.mask}, ${qr.size} by ${qr.size} modules and a four-module quiet zone`);
}

function makeUnmaskedGrid(qr, partMap, mask) {
  const grid = Array.from({ length: qr.size }, function (_, y) {
    return Array.from({ length: qr.size }, function (_, x) {
      let isDark = qr.getModule(x, y);
      const part = partMap[y][x];
      const isDataArea = part === 'data' || part === 'ecc' || part === 'remainder';
      if (isDataArea && maskMatches(mask, x, y)) isDark = !isDark;
      return isDark;
    });
  });
  return grid;
}

function maskMatches(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return (x * y) % 2 + (x * y) % 3 === 0;
    case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    default: return false;
  }
}

function setMaskStage(stage) {
  maskStage = stage;
  document.querySelector('#show-unmasked').setAttribute('aria-pressed', String(stage === 'before'));
  document.querySelector('#show-masked').setAttribute('aria-pressed', String(stage === 'after'));
  updateMaskStage();
}

function updateMaskStage() {
  if (!experimentQr || !unmaskedGrid) return;
  const before = maskStage === 'before';
  const heading = document.querySelector('#mask-stage-title');
  const description = document.querySelector('#mask-stage-description');
  const canvasGrid = before ? unmaskedGrid : null;
  drawQr(maskStageCanvas, experimentQr, experimentParts, hoveredPart || selectedPart, true, canvasGrid);

  if (before) {
    heading.textContent = 'Before mask (intermediate)';
    description.textContent = 'This grid shows the encoded data, error-correction bits, and functional patterns before the data mask. Its format area still has a temporary mask-0 placeholder. It is an intermediate, not a finished QR code, and may not scan.';
    maskStageCanvas.setAttribute('aria-label', 'Unmasked QR construction intermediate; not a finished QR code');
  } else {
    const mask = experimentQr.mask;
    heading.textContent = `After mask ${mask} is applied`;
    description.textContent = `Mask ${mask} flips data-area modules where ${maskDescriptions[mask]} is true. Finder, timing, alignment, and other function modules stay unchanged; the format information is updated to announce mask ${mask}. This is the finished QR code.`;
    maskStageCanvas.setAttribute('aria-label', `Finished QR code using mask ${mask}`);
  }
}

// The encoder exposes a correct module matrix. This function maps coordinates to
// their QR roles using the same placement order and block layout as the encoder.
function classifyModules(qr) {
  const size = qr.size;
  const map = Array.from({ length: size }, function () { return Array(size).fill(''); });
  const format = new Set();

  for (let i = 0; i <= 5; i += 1) {
    format.add(key(8, i));
    format.add(key(i, 8));
  }
  format.add(key(8, 7)); format.add(key(8, 8)); format.add(key(7, 8));
  for (let i = 0; i < 8; i += 1) {
    format.add(key(size - 1 - i, 8));
    format.add(key(8, size - 1 - i));
  }

  const versionInfo = new Set();
  if (qr.version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const x = size - 11 + i % 3;
      const y = Math.floor(i / 3);
      versionInfo.add(key(x, y));
      versionInfo.add(key(y, x));
    }
  }

  const alignment = getAlignmentPositions(qr.version, size);
  const isAlignment = function (x, y) {
    for (let row = 0; row < alignment.length; row += 1) {
      for (let column = 0; column < alignment.length; column += 1) {
        if ((row === 0 && column === 0) || (row === 0 && column === alignment.length - 1) || (row === alignment.length - 1 && column === 0)) continue;
        const centerX = alignment[column];
        const centerY = alignment[row];
        if (Math.abs(x - centerX) <= 2 && Math.abs(y - centerY) <= 2) return true;
      }
    }
    return false;
  };

  function fixedPart(x, y) {
    if ((x <= 7 && y <= 7) || (x >= size - 8 && y <= 7) || (x <= 7 && y >= size - 8)) return 'finder';
    if (format.has(key(x, y))) return 'format';
    if (versionInfo.has(key(x, y))) return 'version';
    if (isAlignment(x, y)) return 'alignment';
    if (x === 6 || y === 6) return 'timing';
    return '';
  }

  const interleavedCodewordTypes = getInterleavedCodewordTypes(qr);
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        const fixed = fixedPart(x, y);
        if (fixed) {
          map[y][x] = fixed;
        } else if (bitIndex < interleavedCodewordTypes.length * 8) {
          map[y][x] = interleavedCodewordTypes[Math.floor(bitIndex / 8)];
          bitIndex += 1;
        } else {
          map[y][x] = 'remainder';
        }
      }
    }
  }
  return map;
}

function key(x, y) { return `${x},${y}`; }

function getAlignmentPositions(version, size) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const positions = [6];
  for (let position = size - 7; positions.length < count; position -= step) {
    positions.splice(1, 0, position);
  }
  return positions;
}

// Codeword types follow the standard's interleaving: data bytes first by column,
// then each block's error-correction bytes by column. The encoder's table values
// are read from its runtime class; TypeScript's private keyword is not a runtime
// access-control mechanism in this compiled JavaScript build.
function getInterleavedCodewordTypes(qr) {
  const QrCode = qrcodegen.QrCode;
  const level = qr.errorCorrectionLevel.ordinal;
  const blockCount = QrCode.NUM_ERROR_CORRECTION_BLOCKS[level][qr.version];
  const eccPerBlock = QrCode.ECC_CODEWORDS_PER_BLOCK[level][qr.version];
  const rawCodewords = Math.floor(QrCode.getNumRawDataModules(qr.version) / 8);
  const shortBlockCount = blockCount - rawCodewords % blockCount;
  const shortBlockLength = Math.floor(rawCodewords / blockCount);
  const blockDataLengths = [];
  for (let block = 0; block < blockCount; block += 1) {
    blockDataLengths.push(shortBlockLength - eccPerBlock + (block < shortBlockCount ? 0 : 1));
  }

  const types = [];
  const fullBlockLength = shortBlockLength + 1;
  for (let column = 0; column < fullBlockLength; column += 1) {
    for (let block = 0; block < blockCount; block += 1) {
      // Short blocks have one virtual padding byte between data and ECC.
      if (column === shortBlockLength - eccPerBlock && block < shortBlockCount) continue;
      types.push(column < blockDataLengths[block] ? 'data' : 'ecc');
    }
  }
  if (types.length !== rawCodewords) throw new Error('Could not map QR codeword blocks.');
  return types;
}

function countPart(map, part) {
  let count = 0;
  for (let y = 0; y < map.length; y += 1) {
    for (let x = 0; x < map[y].length; x += 1) if (map[y][x] === part) count += 1;
  }
  return count;
}

function selectPart(part) {
  selectedPart = part;
  document.querySelectorAll('[data-part]').forEach(function (button) {
    button.setAttribute('aria-pressed', String(button.dataset.part === part));
  });
  partExplanation.textContent = partDescriptions[part];
  drawAllPreviews();
}

function setHoveredPart(part) {
  hoveredPart = part;
  if (part) partExplanation.textContent = partDescriptions[part];
  else partExplanation.textContent = partDescriptions[selectedPart];
  drawAllPreviews();
}

function showLessonStep(index) {
  lessonIndex = Math.max(0, Math.min(lessonSteps.length - 1, index));
  const step = lessonSteps[lessonIndex];
  document.querySelector('#step-count').textContent = `Step ${lessonIndex + 1} of ${lessonSteps.length}`;
  document.querySelector('#step-title').textContent = step.title;
  document.querySelector('#step-description').textContent = step.description;
  document.querySelector('#step-detail').textContent = step.detail;
  document.querySelector('#previous-step').disabled = lessonIndex === 0;
  document.querySelector('#next-step').disabled = lessonIndex === lessonSteps.length - 1;
}

function downloadExperiment() {
  if (!experimentQr) return;
  const cleanCanvas = document.createElement('canvas');
  drawQr(cleanCanvas, experimentQr, experimentParts, 'all', true);
  const link = document.createElement('a');
  link.href = cleanCanvas.toDataURL('image/png');
  link.download = `qr-code-v${experimentQr.version}-ecc-${eccSelect.value}-mask-${experimentQr.mask}.png`;
  document.body.append(link);
  link.click();
  link.remove();
}

function clearGeneratedCodes() {
  standardQr = null;
  experimentQr = null;
  standardParts = null;
  experimentParts = null;
  unmaskedGrid = null;
  maskStage = 'before';
  standardCanvas.width = 0;
  standardCanvas.height = 0;
  experimentCanvas.width = 0;
  experimentCanvas.height = 0;
  maskStageCanvas.width = 0;
  maskStageCanvas.height = 0;
  standardMeta.textContent = 'Automatic mask';
  experimentMeta.textContent = 'Choose a mask to compare';
  document.querySelector('#mask-stage-title').textContent = 'Before mask (intermediate)';
  document.querySelector('#mask-stage-description').textContent = 'Generate a QR code to see the pre-mask data grid.';
  document.querySelector('#show-unmasked').setAttribute('aria-pressed', 'true');
  document.querySelector('#show-masked').setAttribute('aria-pressed', 'false');
  downloadButton.disabled = true;
}

function clearPage() {
  form.reset();
  versionSelect.value = 'auto';
  maskSelect.value = 'auto';
  errorMessage.textContent = '';
  clearGeneratedCodes();
  codeSummary.textContent = 'Enter text and generate a QR code to begin.';
  lessonSteps.forEach(function (step) { step.detail = ''; });
  showLessonStep(0);
  selectPart('all');
  textInput.focus();
}
