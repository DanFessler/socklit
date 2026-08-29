import type { Probe, ProbeContext } from "../types";
import { Console } from "./console";
import { parseGranularity } from "./directory";
import { createCompanyStore } from "./store";

/**
 * An HR console, built to measure the collision named in
 * research/design-probes.md: I2 makes permission-filtered UI safe by
 * construction, and A6 needs the sharing sessions to be authorized identically.
 *
 *   ?probe=roles&user=emp-07                 sign in as a directory member
 *   ?probe=roles&user=emp-07&granularity=coarse
 *
 * `granularity` is `coarse`, `fine`, or `personal`. It changes where in the
 * template tree the authorization decision is taken and nothing about who may
 * see what, which is what makes it a fair independent variable.
 */
export async function create(context: ProbeContext): Promise<Probe> {
  const store = await createCompanyStore(context.dataFile("company.json"));

  return {
    id: "roles",
    title: "Permission-filtered console",
    forces: "I2, A6, the amortization/authorization collision",
    subscribe: (listener) => store.onChange(listener),

    // Everything this session diverges on is either a query parameter, which is
    // fixed for the life of the connection, or state inside <Console>. So the
    // factory has nothing left to retain: it reads the URL once and hands the
    // result down as props.
    //
    // Only the *identity* comes from the query string. The role attached to it
    // is read from the directory on the server, so a tab cannot promote itself
    // by editing the URL.
    createApp: (session) => {
      const userId = session.params.get("user");
      const granularity = parseGranularity(session.params.get("granularity"));
      const requestedRole = session.params.get("role");

      return {
        app: () => Console({ store, userId, granularity, requestedRole }),
      };
    },
  };
}
