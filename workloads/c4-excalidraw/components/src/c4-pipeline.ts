import { layout } from "diagram:c4-pipeline/graph-layout@0.1.0";
import type {
  CompileRequest,
  CompiledScene,
} from "diagram:c4-pipeline/types@0.1.0";

import { compilerCore } from "./c4-compiler.js";

type Compiler = {
  compile(request: CompileRequest): CompiledScene;
};

function compile(request: CompileRequest): CompiledScene {
  const prepared = compilerCore.prepare(request);
  return compilerCore.finish(prepared.state, layout(prepared.layoutRequest));
}

export const compiler: Compiler = { compile };
