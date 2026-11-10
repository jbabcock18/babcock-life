import { formatDotted } from '../format.mjs';
import { esc, icon, leaders, linker, pageHead } from '../layout.mjs';
import { typeset } from '../markdown.mjs';

const text = (value) => esc(typeset(value));

// Line drawings that stand in for screenshots. Colours come from the stylesheet.
const FIGURES = {
  // A volleyball court seen from above: 18 m by 9 m, attack lines three metres from the net.
  court: `<svg class="figure figure--court" viewBox="0 0 360 210" role="img" aria-label="Diagram of a volleyball court from above, with a ball crossing the net">
    <g class="figure__faint">
      <path d="M130 12v18M230 12v18M130 180v18M230 180v18" stroke-dasharray="3 4"/>
      <path d="M30 105h300" stroke-dasharray="1 7"/>
    </g>
    <rect class="figure__line" x="30" y="30" width="300" height="150"/>
    <path class="figure__line" d="M130 30v150M230 30v150"/>
    <path class="figure__strong" d="M180 18v174"/>
    <circle class="figure__post" cx="180" cy="18" r="3"/><circle class="figure__post" cx="180" cy="192" r="3"/>
    <path class="figure__arc" id="court-arc" d="M72 142C128 40 214 28 292 74" pathLength="100"/>
    <circle class="figure__ball" r="5.5"/>
    <g class="figure__label">
      <text x="30" y="204">18 m</text><text x="330" y="204" text-anchor="end">9 m</text><text x="186" y="14">net</text>
    </g>
  </svg>`,

  // A small chart: grid, a river, a route and four pins.
  map: `<svg class="figure figure--map" viewBox="0 0 360 210" role="img" aria-label="Small map with a river, a dashed route and four pins">
    <g class="figure__faint">
      <path d="M30 60h300M30 105h300M30 150h300M90 20v170M150 20v170M210 20v170M270 20v170"/>
    </g>
    <rect class="figure__line" x="30" y="20" width="300" height="170"/>
    <path class="figure__river" d="M30 132c38-8 52-34 86-30s44 40 82 38 50-46 84-52 34 6 48 4"/>
    <path class="figure__river figure__river--bank" d="M30 140c38-8 54-34 86-30s42 40 82 38 52-46 84-52 34 6 48 4"/>
    <path class="figure__arc" d="M72 66c30 10 40 44 78 52s50-30 86-34 44 30 62 52" pathLength="100"/>
    <g class="figure__pins">
      <circle cx="72" cy="66" r="4.5"/><circle cx="150" cy="118" r="4.5"/><circle cx="236" cy="84" r="4.5"/><circle cx="298" cy="136" r="4.5"/>
    </g>
    <g class="figure__label">
      <text x="34" y="204">0</text><text x="150" y="204" text-anchor="middle">1</text><text x="270" y="204" text-anchor="middle">2 km</text>
    </g>
    <path class="figure__strong" d="M30 196h120" /><path class="figure__line" d="M150 196h120"/>
  </svg>`,
};

const figure = (project) => FIGURES[project.figure] || '';

export function projectsIndexPage(model) {
  const page = 'projects.html';
  const to = linker(page);

  const plates = model.projects
    .map(
      (project, i) => `<li class="plate">
            <a class="plate__link" href="${to(project.page)}">
              <div class="plate__figure">${figure(project)}</div>
              <div class="plate__body">
                <p class="label">Nº ${String(i + 1).padStart(2, '0')} · ${formatDotted(project.date)}</p>
                <h2 class="plate__title">${text(project.title)}</h2>
                <p class="plate__summary">${text(project.summary)}</p>
                <span class="more">Read more ${icon('arrow')}</span>
              </div>
            </a>
          </li>`,
    )
    .join('\n          ');

  const body = `      <div class="wrap">
        ${pageHead({ title: 'Projects', lede: 'Selected work.', label: `${model.projects.length} projects` })}
        <ol class="plates">
          ${plates}
        </ol>
      </div>`;

  return { page, section: 'projects', kind: 'projects', title: 'Projects', description: 'Projects by Jack Babcock.', body };
}

export function projectPage(model, project) {
  const page = project.page;
  const to = linker(page);
  const others = model.projects.filter((other) => other !== project);

  const body = `      <article class="wrap project">
        ${pageHead({
          back: { href: to('projects.html'), label: 'projects' },
          label: `Project · ${formatDotted(project.date)}`,
          title: text(project.title),
          lede: text(project.summary),
        })}
        <div class="project__grid">
          <div class="project__figure">${figure(project)}</div>
          <div class="project__body">
            ${project.blocks.map((block) => `<p class="project__lede">${block.html}</p>`).join('\n            ')}
            <p><a class="button" href="${esc(project.link)}" target="_blank" rel="noreferrer">${text(project.linkLabel)} ${icon('arrow-out')}</a></p>
          </div>
        </div>
        ${
          others.length
            ? `<section class="project__more" aria-label="Other projects">
          <h2 class="label">Other projects</h2>
          ${leaders(others.map((other) => ({ href: to(other.page), title: text(other.title), meta: formatDotted(other.date) })))}
        </section>`
            : ''
        }
      </article>`;

  return { page, section: 'projects', kind: 'project', title: project.title, description: project.description, body };
}
