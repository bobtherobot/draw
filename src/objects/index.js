import { registerObjectType } from '../core/registry.js';
import { PathObjectType }      from './path.js';
import { FreeTextObjectType }  from './free-text.js';
import { TextBlockObjectType } from './text-block.js';
import { GroupObjectType }     from './group.js';
import { ArtboardObjectType }  from './artboard.js';

registerObjectType(new PathObjectType());
registerObjectType(new FreeTextObjectType());
registerObjectType(new TextBlockObjectType());
registerObjectType(new GroupObjectType());
registerObjectType(new ArtboardObjectType());
