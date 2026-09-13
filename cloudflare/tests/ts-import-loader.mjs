import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../');
      const finalSegment = specifier.split('/').at(-1) || '';
      const hasExtension = finalSegment.includes('.');
      if (!relative || hasExtension) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
