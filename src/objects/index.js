import { registerObjectType } from '../core/registry.js';
import { PathObjectType }      from './path.js';
import { TextLineObjectType }  from './text-line.js';
import { TextBlockObjectType } from './text-block.js';
import { GroupObjectType }     from './group.js';

registerObjectType(new PathObjectType());
registerObjectType(new TextLineObjectType());
registerObjectType(new TextBlockObjectType());
registerObjectType(new GroupObjectType());
