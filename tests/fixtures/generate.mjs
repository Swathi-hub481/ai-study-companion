/**
 * Generates the PDF fixtures used by the document-processing tests.
 *
 * Checked in as a script rather than as binary blobs so the fixtures are
 * reproducible and reviewable, and so the "scanned" fixture is genuinely
 * image-only (no text layer) — which is the only way to test the OCR path honestly.
 *
 * Usage: node tests/fixtures/generate.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { createCanvas } = require("@napi-rs/canvas");

const here = path.dirname(fileURLToPath(import.meta.url));

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

/** Distinctive, searchable sentences so tests can assert on retrieval. */
const PAGES = [
  [
    "Gradient Descent: Core Notes",
    "",
    "Gradient descent is an iterative optimisation algorithm that minimises a loss",
    "function by repeatedly stepping in the direction of the negative gradient.",
    "",
    "The learning rate controls the size of each step. A rate that is too large can",
    "cause the optimisation to diverge, while a rate that is too small makes",
    "convergence painfully slow.",
    "",
    "Batch gradient descent computes the gradient over the entire training set.",
    "Stochastic gradient descent uses a single example per step, which introduces",
    "noise but often converges faster in practice.",
  ],
  [
    "Momentum and Adaptive Methods",
    "",
    "Momentum accumulates an exponentially decaying average of past gradients. This",
    "damps oscillation across ravines and accelerates movement along consistent",
    "directions.",
    "",
    "Nesterov momentum looks ahead by evaluating the gradient at the approximate",
    "future position rather than the current one.",
    "",
    "AdaGrad scales the learning rate per parameter by the square root of the sum of",
    "squared historical gradients, which suits sparse features but decays the rate",
    "aggressively over time.",
    "",
    "Adam combines momentum with adaptive scaling and is frequently the default",
    "choice for deep networks.",
  ],
  [
    "Regularisation and Generalisation",
    "",
    "Overfitting occurs when a model captures noise in the training set rather than",
    "the underlying signal, and so performs poorly on unseen data.",
    "",
    "L2 regularisation penalises the squared magnitude of weights, encouraging",
    "smaller parameters and a smoother decision boundary.",
    "",
    "Dropout randomly deactivates units during training, which prevents the network",
    "from becoming overly reliant on any single pathway.",
    "",
    "The bias-variance tradeoff describes the tension between a model that is too",
    "simple to capture the structure and one that is too flexible to generalise.",
  ],
];

async function createTextDocument() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (const lines of PAGES) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - 72;

    for (const line of lines) {
      if (line) {
        page.drawText(line, { x: 72, y, size: 12, font, color: rgb(0, 0, 0) });
      }
      y -= 18;
    }
  }

  return Buffer.from(await pdf.save());
}

/**
 * A page whose only content is a raster image of text — no font, no text layer.
 * Text extraction must therefore return little or nothing, and OCR is the only way
 * to recover the content.
 */
async function createScannedDocument() {
  const canvas = createCanvas(1000, 700);
  const context = canvas.getContext("2d");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 1000, 700);

  context.fillStyle = "#000000";
  context.font = "48px sans-serif";
  context.fillText("Scanned Page", 80, 200);
  context.font = "36px sans-serif";
  context.fillText("Backpropagation applies the chain rule.", 80, 300);
  context.fillText("It propagates error signals backwards.", 80, 370);

  const png = canvas.toBuffer("image/png");

  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(png);
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  page.drawImage(image, { x: 0, y: PAGE_HEIGHT - 500, width: PAGE_WIDTH, height: 420 });

  return Buffer.from(await pdf.save());
}

await mkdir(here, { recursive: true });

const textPdf = await createTextDocument();
await writeFile(path.join(here, "text-document.pdf"), textPdf);
console.log(`text-document.pdf  ${textPdf.length} bytes (3 pages with a text layer)`);

const scannedPdf = await createScannedDocument();
await writeFile(path.join(here, "scanned-document.pdf"), scannedPdf);
console.log(`scanned-document.pdf  ${scannedPdf.length} bytes (1 image-only page)`);
