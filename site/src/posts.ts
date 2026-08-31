import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type PostKind = "essay" | "compare";

export type Post = {
  slug: string;
  title: string;
  kicker: string;
  lede: string;
  date: string;
  kind: PostKind;
  file: string;
};

export const POSTS: Post[] = [
  {
    slug: "building-a-todo-app",
    title: "Let me build you a todo app",
    kicker: "Essay",
    lede: "A list, then a store, then a second tab. The line that was already the whole thing is the first one.",
    date: "2026-08-30",
    kind: "essay",
    file: "building-a-todo-app.md",
  },
  {
    slug: "socklit-vs-spa",
    title: "Socklit vs REST + SPA, a Deep Dive",
    kicker: "Compare",
    lede: "Four copies of the same fact, and a fifth if you add a socket. Socklit keeps one. That is the human-complexity argument, not a speed argument.",
    date: "2026-08-30",
    kind: "compare",
    file: "socklit-vs-spa.md",
  },
  {
    slug: "socklit-vs-rsc",
    title: "Socklit vs Next / RSC, a Deep Dive",
    kicker: "Compare",
    lede: "RSC serialized a mixed tree. It is still request/response. A file suffix is not a live session, and a mount is not \"use client\".",
    date: "2026-08-30",
    kind: "compare",
    file: "socklit-vs-rsc.md",
  },
  {
    slug: "socklit-vs-liveview",
    title: "Socklit vs LiveView, a Deep Dive",
    kicker: "Compare",
    lede: "The closest relative on the wire. A name versus an address. The ergonomic win and the recovery burden are the same decision.",
    date: "2026-08-30",
    kind: "compare",
    file: "socklit-vs-liveview.md",
  },
  {
    slug: "socklit-vs-htmx",
    title: "Socklit vs htmx, a Deep Dive",
    kicker: "Compare",
    lede: "The most serious competitor, and not because it is similar. For most internal tools, htmx is the better answer.",
    date: "2026-08-30",
    kind: "compare",
    file: "socklit-vs-htmx.md",
  },
  {
    slug: "socklit-vs-meteor",
    title: "Socklit vs Meteor, a Deep Dive",
    kicker: "Compare",
    lede: "Meteor replicated the database. Socklit keeps the UI on the server. The client physically never receives what was not painted.",
    date: "2026-08-30",
    kind: "compare",
    file: "socklit-vs-meteor.md",
  },
];

const postsDir = join(dirname(fileURLToPath(import.meta.url)), "posts");

export function postHref(post: Post): string {
  return `/blog/${post.slug}`;
}

export function findPost(slug: string): Post | undefined {
  return POSTS.find((post) => post.slug === slug);
}

export function readPost(post: Post): string {
  return readFileSync(join(postsDir, post.file), "utf8");
}
