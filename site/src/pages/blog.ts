import { component, html, keyed } from "socklit/server";

import { renderMarkdown } from "../markdown";
import {
  POSTS,
  findPost,
  postHref,
  readPost,
  type Post,
} from "../posts";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${iso}T00:00:00`));
}

export function matchPost(path: string): Post | undefined {
  if (!path.startsWith("/blog/")) return undefined;
  return findPost(path.slice("/blog/".length));
}

export const BlogIndex = component(function BlogIndex() {
  const essays = POSTS.filter((post) => post.kind === "essay");
  const compares = POSTS.filter((post) => post.kind === "compare");

  return html`
    <header class="page-head">
      <p class="kicker">Blog</p>
      <h1>How the thing actually feels to write.</h1>
      <p class="lede">
        Guided builds and honest comparisons. The compare table is the
        scoreboard; these are the arguments.
      </p>
    </header>

    <section class="prose">
      <h2>Essays</h2>
      <ol class="post-list">
        ${keyed(
          essays,
          (post) => post.slug,
          (post) => PostCard({ post }),
        )}
      </ol>

      <h2>Deep dives</h2>
      <p>
        One essay per row of
        <a href="/compare">the comparison</a>. Same facts, more room.
      </p>
      <ol class="post-list">
        ${keyed(
          compares,
          (post) => post.slug,
          (post) => PostCard({ post }),
        )}
      </ol>
    </section>
  `;
});

const PostCard = component(function PostCard(props: { post: Post }) {
  const { post } = props;
  return html`
    <li class="post-card">
      <p class="post-meta">
        <span>${post.kicker}</span>
        <time datetime=${post.date}>${formatDate(post.date)}</time>
      </p>
      <h3>
        <a href=${postHref(post)}>${post.title}</a>
      </h3>
      <p>${post.lede}</p>
    </li>
  `;
});

export const BlogPost = component(function BlogPost(props: { post: Post }) {
  const { post } = props;
  return html`
    <article class="article">
      <header class="page-head">
        <p class="kicker">${post.kicker}</p>
        <h1>${post.title}</h1>
        <p class="lede">${post.lede}</p>
        <p class="post-meta">
          <time datetime=${post.date}>${formatDate(post.date)}</time>
        </p>
      </header>
      <div class="prose">${renderMarkdown(readPost(post))}</div>
      <p class="after">
        <a href="/blog">All posts</a>
        ${post.kind === "compare" ? html` · <a href="/compare">Compare</a>` : ""}
      </p>
    </article>
  `;
});
