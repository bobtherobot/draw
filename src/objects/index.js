import { registerBaseObject } from '../core/registry.js';
import { Path }      from './types/Path.js';
import { FreeText }  from './types/FreeText.js';
import { TextBlock } from './types/TextBlock.js';
import { Group }     from './types/Group.js';
import { Artboard }  from './types/Artboard.js';

registerBaseObject(new Path());
registerBaseObject(new FreeText());
registerBaseObject(new TextBlock());
registerBaseObject(new Group());
registerBaseObject(new Artboard());
