/**
 * Regression tests for CanvasKit surface acquisition.
 *
 * Context: CanvasKit's MakeWebGLCanvasSurface does not return null when it
 * cannot obtain a WebGL context — it *throws* a string:
 *
 *   if (!m || 0 > m) throw "failed to create webgl context: err " + m;
 *
 * The renderer originally used `MakeWebGLCanvasSurface(c) ?? MakeSWCanvasSurface(c)`,
 * so the intended CPU fallback was unreachable and the throw propagated out of
 * main.js's top-level await, aborting app boot entirely (blank page, no toolbar).
 *
 * Run: node --test tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSurface } from '../src/render/surface.js';

const CANVAS = { width: 800, height: 600 };

function gpuSurface()  { return { kind: 'gpu' }; }
function cpuSurface()  { return { kind: 'cpu' }; }

test('prefers the GPU surface when WebGL is available', () => {
  const CK = {
    MakeWebGLCanvasSurface: () => gpuSurface(),
    MakeSWCanvasSurface:    () => assert.fail('CPU fallback must not run when WebGL works'),
  };
  assert.equal(makeSurface(CK, CANVAS).kind, 'gpu');
});

test('falls back to CPU when MakeWebGLCanvasSurface THROWS', () => {
  // This is the real-world failure: no GPU / WebGL disabled in the browser.
  const CK = {
    MakeWebGLCanvasSurface: () => { throw 'failed to create webgl context: err 0'; },
    MakeSWCanvasSurface:    () => cpuSurface(),
  };
  assert.equal(makeSurface(CK, CANVAS).kind, 'cpu');
});

test('falls back to CPU when MakeWebGLCanvasSurface returns null', () => {
  const CK = {
    MakeWebGLCanvasSurface: () => null,
    MakeSWCanvasSurface:    () => cpuSurface(),
  };
  assert.equal(makeSurface(CK, CANVAS).kind, 'cpu');
});

test('throws a clear diagnostic when both GPU and CPU fail', () => {
  const CK = {
    MakeWebGLCanvasSurface: () => { throw 'failed to create webgl context: err 0'; },
    MakeSWCanvasSurface:    () => null,
  };
  assert.throws(() => makeSurface(CK, CANVAS), /could not create a CanvasKit surface/);
});

test('surfaces the original WebGL error as the cause, not silently', () => {
  const seen = [];
  const CK = {
    MakeWebGLCanvasSurface: () => { throw 'failed to create webgl context: err 0'; },
    MakeSWCanvasSurface:    () => cpuSurface(),
  };
  makeSurface(CK, CANVAS, { warn: msg => seen.push(msg) });
  assert.equal(seen.length, 1);
  assert.match(seen[0], /err 0/);
});
