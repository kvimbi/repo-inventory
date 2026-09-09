import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const svgPath = resolve(rootDir, "web/public/favicon.svg");
const buildDir = resolve(rootDir, "build");
const iconsetDir = resolve(buildDir, "icon.iconset");

if (!existsSync(svgPath)) {
  console.error(`SVG not found at: ${svgPath}`);
  process.exit(1);
}

if (process.platform !== "darwin") {
  if (existsSync(resolve(buildDir, "icon.icns")) && existsSync(resolve(buildDir, "icon.png"))) {
    console.log("Icons already present (non-macOS system, skipping icon generation).");
    process.exit(0);
  }
  console.warn("Warning: Full icon generation requires macOS. Please build icons on macOS.");
  process.exit(0);
}

mkdirSync(buildDir, { recursive: true });
if (existsSync(iconsetDir)) {
  rmSync(iconsetDir, { recursive: true, force: true });
}
mkdirSync(iconsetDir, { recursive: true });

// Required macOS iconset sizes
const iconSizes = [
  { name: "icon_16x16.png", size: 16 },
  { name: "icon_16x16@2x.png", size: 32 },
  { name: "icon_32x32.png", size: 32 },
  { name: "icon_32x32@2x.png", size: 64 },
  { name: "icon_128x128.png", size: 128 },
  { name: "icon_128x128@2x.png", size: 256 },
  { name: "icon_256x256.png", size: 256 },
  { name: "icon_256x256@2x.png", size: 512 },
  { name: "icon_512x512.png", size: 512 },
  { name: "icon_512x512@2x.png", size: 1024 },
];

const jxaScript = `
ObjC.import("AppKit");
ObjC.import("Foundation");

function renderSvg(svgPath, outPngPath, size) {
  var fullSvg = $(svgPath);
  var fullOut = $(outPngPath);

  var img = $.NSImage.alloc.initWithContentsOfFile(fullSvg);
  if (!img) {
    throw new Error("Failed to load SVG: " + svgPath);
  }

  var rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    $.nil, size, size, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0
  );
  rep.setSize($.NSMakeSize(size, size));

  $.NSGraphicsContext.saveGraphicsState;
  var ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);
  $.NSGraphicsContext.setCurrentContext(ctx);

  var rect = $.NSMakeRect(0, 0, size, size);
  img.drawInRectFromRectOperationFraction(rect, $.NSZeroRect, $.NSCompositingOperationCopy, 1.0);

  $.NSGraphicsContext.restoreGraphicsState;

  var pngData = rep.representationUsingTypeProperties($.NSPNGFileType, $({}));
  pngData.writeToFileAtomically(fullOut, true);
}

function run(argv) {
  var tasks = JSON.parse(argv[0]);
  for (var i = 0; i < tasks.length; i++) {
    renderSvg(tasks[i].svg, tasks[i].out, tasks[i].size);
  }
}
`;

const renderTasks = [
  { svg: svgPath, out: resolve(buildDir, "icon.png"), size: 1024 },
  ...iconSizes.map((item) => ({
    svg: svgPath,
    out: resolve(iconsetDir, item.name),
    size: item.size,
  })),
];

console.log("Rasterizing SVG into multi-resolution PNGs…");
execFileSync("osascript", ["-l", "JavaScript", "-e", jxaScript, JSON.stringify(renderTasks)], {
  stdio: "inherit",
});

console.log("Compiling icon.icns with iconutil…");
execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", resolve(buildDir, "icon.icns")], {
  stdio: "inherit",
});

// Clean up intermediate iconset directory
rmSync(iconsetDir, { recursive: true, force: true });

// Build Windows ICO file containing [16, 24, 32, 48, 64, 128, 256]
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoTasks = icoSizes.map((size) => ({
  svg: svgPath,
  out: resolve(buildDir, `temp_ico_${size}.png`),
  size,
}));

execFileSync("osascript", ["-l", "JavaScript", "-e", jxaScript, JSON.stringify(icoTasks)], {
  stdio: "inherit",
});

const pngBuffers = icoSizes.map((size) => {
  const filePath = resolve(buildDir, `temp_ico_${size}.png`);
  const buf = readFileSync(filePath);
  rmSync(filePath, { force: true });
  return { size, buf };
});

function createIco(images) {
  const count = images.length;
  const headerSize = 6;
  const entrySize = 16;
  let offset = headerSize + count * entrySize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon type
  header.writeUInt16LE(count, 4); // count

  const entries = [];
  const body = [];

  for (const img of images) {
    const entry = Buffer.alloc(entrySize);
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 0); // width
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 1); // height
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(img.buf.length, 8); // image size
    entry.writeUInt32LE(offset, 12); // image offset

    entries.push(entry);
    body.push(img.buf);
    offset += img.buf.length;
  }

  return Buffer.concat([header, ...entries, ...body]);
}

const icoBuffer = createIco(pngBuffers);
writeFileSync(resolve(buildDir, "icon.ico"), icoBuffer);

console.log("Successfully generated:");
console.log("  build/icon.icns");
console.log("  build/icon.png");
console.log("  build/icon.ico");
