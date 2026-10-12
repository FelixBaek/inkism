import { Video } from "./video";
import { Audio } from "./audio";
import { Diagram } from "./diagram";
import { Model3d } from "./model3d";
import { AiBlock } from "./ai-block";
import { Embed } from "./embed";
import "./media.css";

/** Media and AI block nodes; commands: insertVideo, insertAudio, insertDiagram, insertModel3d, insertAiBlock, insertEmbed. */
export const mediaExtensions = [Video, Audio, Diagram, Model3d, AiBlock, Embed];
