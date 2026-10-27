// Match results: tracks each player's damage, gold earned and buildings destroyed from match
// events, and when a main base falls shows the winner, every player's line and the MVP, with
// buttons for a rematch (same options, no menu) or the main menu.
import type { Match, MatchEvent, Team } from '@boom/sim';
import { clean } from './info.ts';
import { icon } from './tooltip.ts';

interface Line { damage: number; taken: number; gold: number; structures: number }

export class Results {
  private readonly match: Match;
  private readonly player: number;
  private readonly lines = new Map<number, Line>();
  private shown = false;

  constructor(match: Match, player: number) {
    this.match = match;
    this.player = player;
  }

  private line(p: number): Line {
    let l = this.lines.get(p);
    if (!l) this.lines.set(p, (l = { damage: 0, taken: 0, gold: 0, structures: 0 }));
    return l;
  }

  onEvents(events: MatchEvent[]): void {
    for (const e of events) {
      if (e.kind === 'hit') {
        this.line(e.sourceOwner).damage += e.damage;
        const target = this.match.world.unit(e.targetId);
        if (target?.isHero) this.line(target.owner).taken += e.damage;
      }
      if (e.kind === 'gold') this.line(e.player).gold += e.amount;
      if (e.kind === 'death' && e.structure) this.line(e.killerOwner).structures++;
      if (e.kind === 'victory' && !this.shown) {
        this.shown = true;
        // Let the base's explosion and the banner play first.
        setTimeout(() => this.show(e.winner), 3500);
      }
    }
  }

  private show(winner: Team): void {
    const me = this.match.players.get(this.player)!;
    const won = me.team === winner;
    const t = Math.floor(this.match.seconds);
    const players = [...this.match.players.values()].filter((p) => p.index >= 2);
    const mvp = players.reduce((best, p) => (this.score(p.index) > this.score(best.index) ? p : best), players[0]!);
    const row = (p: (typeof players)[number]) => {
      const l = this.line(p.index);
      const ship = clean(this.match.world.shipType(p.shipTypeId)?.name);
      return `<tr class="${p.index === this.player ? 'me' : ''}">
        <td>${p.index === this.player ? '你' : `玩家 ${p.index - 1}`}${p === mvp ? ' <b class="mvp">MVP</b>' : ''}</td>
        <td class="ship">${icon('ship', p.shipTypeId, ship, 'mini')}${ship}</td><td>${p.hero.level}</td><td>${p.kills} / ${p.deaths}</td>
        <td>${Math.round(l.damage).toLocaleString()}</td><td>${Math.round(l.taken).toLocaleString()}</td>
        <td>${l.gold.toLocaleString()}</td><td>${l.structures}</td></tr>`;
    };
    const head = '<tr><th>玩家</th><th>船只</th><th>等级</th><th>击沉/阵亡</th><th>造成伤害</th><th>承受伤害</th><th>金钱收入</th><th>摧毁建筑</th></tr>';
    const side = (team: Team, name: string) => {
      const list = players.filter((p) => p.team === team);
      return list.length ? `<h3 class="${team}">${name}${team === winner ? ' · 胜利' : ''}</h3><table>${head}${list.map(row).join('')}</table>` : '';
    };
    const root = Object.assign(document.body.appendChild(document.createElement('div')), { className: `results ${won ? 'won' : 'lost'}` });
    root.innerHTML = `<div class="results-card">
      <h1>${won ? '胜利' : '战败'}</h1>
      <i class="divider"></i>
      <p class="results-sub">${winner === 'south' ? '南方' : '北方'}舰队摧毁了敌方主基地 · 用时 ${Math.floor(t / 60)} 分 ${t % 60} 秒</p>
      ${side('south', '南方')}${side('north', '北方')}
      <div class="results-actions">
        <button class="primary" data-action="again">再来一局</button>
        <button data-action="menu">返回主菜单</button>
      </div>
    </div>`;
    root.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest('button')?.dataset.action;
      if (action === 'again') location.href = `${location.pathname}?play`;
      if (action === 'menu') location.href = location.pathname;
    });
    document.querySelector('.banner')?.classList.remove('show');
  }

  /** MVP: kills, damage and buildings, with deaths held against. */
  private score(p: number): number {
    const s = this.match.players.get(p)!, l = this.line(p);
    return s.kills * 3 - s.deaths + l.damage / 2000 + l.structures * 2;
  }
}
