import {setupFFprobe} from './ffprobe.mjs';
setupFFprobe();
import {installationContract} from './lifecycle.mjs';
console.log(JSON.stringify({package:'@petercjl/infinite-canvas-cli',complete:false,code:'SKILL_SETUP_REQUIRED',message:'The CLI and bundled Skill are installed in the npm package. The current Agent must install/verify the companion Skill in its own Skill directory before reporting installation or update complete.',...installationContract}));
