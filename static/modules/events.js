EDU.registerModule('events', {
  async render(host) {
    const { h } = EDU;
    const meta =
      await EDU.api('/events/meta');
    let view = 'list';
    let when = 'upcoming';
    let type = '';
    let level = '';
    const cur = new Date();
    let year =
      cur.getFullYear();
    let month =
      cur.getMonth() + 1;
    const controls = h(
      'div',
      {
        class:
          'events3-controls'
      }
    );
    const body = h(
      'div',
      {
        class:
          'events3-body'
      },
      EDU.skeleton(4)
    );
    const makeSelect = (
      items,
      first,
      valueGetter,
      valueSetter
    ) => {
      const select =
        h(
          'select',
          {
            class:
              'events3-select',
            onchange: () => {
              valueSetter(
                select.value
              );
              draw();
            }
          },
          h(
            'option',
            {
              value: ''
            },
            first
          ),
          ...items
        );
      select.value =
        valueGetter();
      return select;
    };
    async function renderList() {
      const q =
        new URLSearchParams();
      const today =
        EDU.isoToday();
      if (when === 'upcoming') {
        q.set(
          'date_from',
          today
        );
      }
      if (type) {
        q.set(
          'type_id',
          type
        );
      }
      if (level) {
        q.set(
          'level_id',
          level
        );
      }
      let rows =
        await EDU.api(
          '/events?' +
          q.toString()
        );
      if (when === 'past') {
        rows =
          rows
            .filter(
              e =>
                e.end_date < today
            )
            .reverse();
      }
      if (!rows.length) {
        return h(
          'div',
          {
            class:
              'events3-empty'
          },
          h(
            'strong',
            {},
            'Мероприятий не найдено'
          ),
          h(
            'span',
            {},
            'Попробуйте изменить выбранные фильтры.'
          )
        );
      }
      return h(
        'section',
        {
          class:
            'events3-panel'
        },
        h(
          'div',
          {
            class:
              'events3-panel-head'
          },
          h(
            'div',
            {},
            h(
              'span',
              {
                class:
                  'events3-eyebrow'
              },
              'Каталог'
            ),
            h(
              'h2',
              {},
              when === 'upcoming'
                ? 'Ближайшие мероприятия'
                : when === 'past'
                  ? 'Прошедшие мероприятия'
                  : 'Все мероприятия'
            )
          ),
          h(
            'span',
            {
              class:
                'events3-count'
            },
            `Найдено: ${rows.length}`
          )
        ),
        h(
          'div',
          {
            class:
              'timeline events3-timeline'
          },
          ...rows.map(
            e =>
              EDU.eventRow(e)
          )
        )
      );
    }
    async function renderCalendar() {
      const first =
        new Date(
          year,
          month - 1,
          1
        );
      const days =
        new Date(
          year,
          month,
          0
        ).getDate();
      const iso = (d) =>
        `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const rows =
        await EDU.api(
          `/events?date_from=${iso(1)}&date_to=${iso(days)}` +
          `${type ? '&type_id=' + type : ''}` +
          `${level ? '&level_id=' + level : ''}`
        );
      const byDay = {};
      rows.forEach(
        e => {
          const d =
            EDU.date(
              e.start_date
            );
          if (
            d.getMonth() + 1 === month &&
            d.getFullYear() === year
          ) {
            (
              byDay[
                d.getDate()
              ] ||= []
            ).push(e);
          }
        }
      );
      const offset =
        (
          first.getDay() + 6
        ) % 7;
      const cells = [];
      for (
        let i = 0;
        i < offset;
        i++
      ) {
        cells.push(
          h(
            'div',
            {
              class:
                'events3-cal-cell off'
            }
          )
        );
      }
      for (
        let d = 1;
        d <= days;
        d++
      ) {
        const isToday =
          d === cur.getDate() &&
          month ===
            cur.getMonth() + 1 &&
          year ===
            cur.getFullYear();
        const evs =
          byDay[d] || [];
        cells.push(
          h(
            'div',
            {
              class:
                'events3-cal-cell' +
                (
                  isToday
                    ? ' today'
                    : ''
                )
            },
            h(
              'div',
              {
                class:
                  'events3-cal-date'
              },
              h(
                'b',
                {},
                String(d)
              )
            ),
            h(
              'div',
              {
                class:
                  'events3-cal-items'
              },
              ...evs
                .slice(0, 3)
                .map(
                  e =>
                    h(
                      'button',
                      {
                        type:
                          'button',
                        class:
                          `events3-cal-event t-${e.event_type}`,
                        title:
                          `${e.title}\n` +
                          `${EDU.lbl('event_type', e.event_type)}, ` +
                          `${EDU.lbl('level', e.level)}`,
                        onclick:
                          () =>
                            EDU.toast(
                              `${e.title}: ` +
                              `${EDU.lbl('event_type', e.event_type)}, ` +
                              `${EDU.lbl('level', e.level)}` +
                              `${e.place ? ', ' + e.place : ''}`
                            )
                      },
                      e.title
                    )
                ),
              evs.length > 3
                ? h(
                    'span',
                    {
                      class:
                        'events3-more-events'
                    },
                    `+ ещё ${evs.length - 3}`
                  )
                : null
            )
          )
        );
      }
      const shift =
        (n) => {
          month += n;
          if (month < 1) {
            month = 12;
            year--;
          }
          if (month > 12) {
            month = 1;
            year++;
          }
          draw();
        };
      const monthTitle =
        first
          .toLocaleString(
            'ru-RU',
            {
              month:
                'long',
              year:
                'numeric'
            }
          );
      return h(
        'section',
        {
          class:
            'events3-panel events3-calendar-panel'
        },
        h(
          'div',
          {
            class:
              'events3-calendar-head'
          },
          h(
            'button',
            {
              type:
                'button',
              class:
                'events3-calendar-arrow',
              onclick:
                () =>
                  shift(-1)
            },
            '←'
          ),
          h(
            'div',
            {
              class:
                'events3-calendar-title'
            },
            h(
              'span',
              {
                class:
                  'events3-eyebrow'
              },
              'Календарь'
            ),
            h(
              'h2',
              {},
              monthTitle
            )
          ),
          h(
            'button',
            {
              type:
                'button',
              class:
                'events3-calendar-arrow',
              onclick:
                () =>
                  shift(1)
            },
            '→'
          )
        ),
        h(
          'div',
          {
            class:
              'events3-calendar'
          },
          ...[
            'Пн',
            'Вт',
            'Ср',
            'Чт',
            'Пт',
            'Сб',
            'Вс'
          ].map(
            n =>
              h(
                'div',
                {
                  class:
                    'events3-cal-weekday'
                },
                n
              )
          ),
          ...cells
        )
      );
    }
    async function draw() {
      const viewTabs =
        h(
          'div',
          {
            class:
              'events3-view-tabs'
          },
          ...[
            [
              'list',
              'Список'
            ],
            [
              'month',
              'Календарь'
            ]
          ].map(
            ([id, title]) =>
              h(
                'button',
                {
                  type:
                    'button',
                  class:
                    'events3-view-tab' +
                    (
                      view === id
                        ? ' active'
                        : ''
                    ),
                  onclick:
                    () => {
                      view = id;
                      draw();
                    }
                },
                title
              )
          )
        );
      const whenSelect =
        view === 'list'
          ? h(
              'select',
              {
                class:
                  'events3-select',
                onchange:
                  (e) => {
                    when =
                      e.target.value;
                    draw();
                  }
              },
              ...[
                [
                  'upcoming',
                  'Ближайшие'
                ],
                [
                  'past',
                  'Прошедшие'
                ],
                [
                  'all',
                  'Все'
                ]
              ].map(
                ([value, title]) =>
                  h(
                    'option',
                    {
                      value,
                      selected:
                        value === when
                    },
                    title
                  )
              )
            )
          : null;
      const typeSelect =
        makeSelect(
          meta.types.map(
            t =>
              h(
                'option',
                {
                  value:
                    t.event_type_id
                },
                EDU.lbl(
                  'event_type',
                  t.name
                )
              )
          ),
          'Все типы',
          () => type,
          value => {
            type = value;
          }
        );
      const levelSelect =
        makeSelect(
          meta.levels.map(
            l =>
              h(
                'option',
                {
                  value:
                    l.level_id
                },
                EDU.lbl(
                  'level',
                  l.name
                )
              )
          ),
          'Все уровни',
          () => level,
          value => {
            level = value;
          }
        );
      controls.replaceChildren(
        h(
          'div',
          {
            class:
              'events3-controls-main'
          },
          viewTabs,
          whenSelect
        ),
        h(
          'div',
          {
            class:
              'events3-filter-group'
          },
          typeSelect,
          levelSelect
        )
      );
      body.replaceChildren(
        EDU.skeleton(4)
      );
      try {
        body.replaceChildren(
          view === 'list'
            ? await renderList()
            : await renderCalendar()
        );
      }
      catch (e) {
        EDU.fail(
          body,
          e
        );
      }
    }
    host.replaceChildren(
      h(
        'section',
        {
          class:
            'events3-hero'
        },
        h(
          'div',
          {},
          h(
            'span',
            {
              class:
                'events3-kicker'
            },
            'Календарь активности'
          ),
          h(
            'h1',
            {},
            'Мероприятия'
          ),
          h(
            'p',
            {},
            'Олимпиады, конференции, конкурсы, соревнования и хакатоны.'
          )
        ),
        h(
          'div',
          {
            class:
              'events3-legend'
          },
          ...[
            [
              'var(--t-olympiad)',
              'Олимпиада'
            ],
            [
              'var(--t-conference)',
              'Конференция'
            ],
            [
              'var(--t-contest)',
              'Конкурс'
            ],
            [
              'var(--t-competition)',
              'Соревнование'
            ],
            [
              'var(--t-hackathon)',
              'Хакатон'
            ]
          ].map(
            ([color, label]) =>
              h(
                'span',
                {},
                h(
                  'i',
                  {
                    style:
                      `background:${color}`
                  }
                ),
                label
              )
          )
        )
      ),
      controls,
      body
    );
    await draw();
  }
});
