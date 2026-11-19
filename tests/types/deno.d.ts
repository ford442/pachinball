/**
 * The slice of the Deno runtime API that `supabase/functions/_shared/arcade.ts` uses. Tests import
 * that module's pure validators (patterns, field checks) under Node; its Deno-only helpers are never
 * called there, but tsconfig.tests.json type-checks the whole file, so `Deno` needs a declaration.
 * Kept narrow on purpose: the Edge Functions themselves are type-checked by Deno, not by tsc.
 */
declare namespace Deno {
  const env: { get(key: string): string | undefined }
  function serve(handler: (req: Request) => Response | Promise<Response>): unknown
}
