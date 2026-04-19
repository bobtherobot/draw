const undoStack = [];
const redoStack = [];

export function execute(cmd) {
  cmd.do();
  undoStack.push(cmd);
  redoStack.length = 0;
}

export function undo() {
  const cmd = undoStack.pop();
  if (cmd) { cmd.undo(); redoStack.push(cmd); }
}

export function redo() {
  const cmd = redoStack.pop();
  if (cmd) { cmd.do(); undoStack.push(cmd); }
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }
