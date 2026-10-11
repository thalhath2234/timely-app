// The shared packages import their siblings without an extension, as the
// apps' bundlers allow; teach Node's loader the same. Use with --import.
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s,c,n){try{return await n(s,c)}catch(e){if(s.startsWith('.')&&!s.endsWith('.ts'))return n(s+'.ts',c);throw e}}",
    ),
);
