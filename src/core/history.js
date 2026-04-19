/**
 * Undo/redo command stack.
 * Each command: { do(), undo() }
 */
import { emit } from './events.js';

const undoStack = [];
const redoStack = [];

export function execute(cmd) {
  cmd.do();
  undoStack.push(cmd);
  redoStack.length = 0;
  emit('history-change');
}

export function undo() {
  const cmd = undoStack.pop();
  if (!cmd) return;
  cmd.undo();
  redoStack.push(cmd);
  emit('history-change');
}

export function redo() {
  const cmd = redoStack.pop();
  if (!cmd) return;
  cmd.do();
  undoStack.push(cmd);
  emit('history-change');
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
