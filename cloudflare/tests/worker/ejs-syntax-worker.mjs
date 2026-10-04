import { parseEjs, parseRegex } from '../../src/utils/ejs-checker/syntax.mjs';
import { analyzeProjectCode, toUploaderCodeCheck } from '../../src/utils/ejs-preflight.mjs';

// A local-only runtime probe. It only parses the supplied text, never runs it.
export default {
  async fetch(request) {
    const input = await request.json();
    if (Array.isArray(input.inputs)) return Response.json(toUploaderCodeCheck(analyzeProjectCode(input.inputs)));
    const parsed = input.type === 'regex' ? parseRegex(input.content) : parseEjs(input.content);
    return Response.json({errors:parsed.errors,internalErrors:parsed.internalErrors,units:parsed.units.length,ast:parsed.units.map(unit=>unit.ast?.type??null)});
  },
};
