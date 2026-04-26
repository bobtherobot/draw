import { registerObjectType } from '../core/registry.js';
import { Path }      from './types/Path.js';
import { FreeText }  from './types/FreeText.js';
import { TextBlock } from './types/TextBlock.js';
import { Group }     from './types/Group.js';
import { Artboard }  from './types/Artboard.js';

registerObjectType(Path);
registerObjectType(FreeText);
registerObjectType(TextBlock);
registerObjectType(Group);
registerObjectType(Artboard);
