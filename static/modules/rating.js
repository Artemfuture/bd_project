EDU.registerModule('rating', {
  async render(host) {
    const { h } = EDU;
    const me = EDU.me;
    const isStudent = me.role === 'student';
    const isStaff = me.role === 'staff';
    const canOpenStudent =
      me.role === 'staff' ||
      me.role === 'lecturer';
    const meta =
      await EDU.api('/rating/meta');
    let period =
      meta.default_period_id;
    let group = '';
    const heroStats = h(
      'div',
      {
        class:
          'rating3-hero-stats'
      },
      EDU.skeleton(2)
    );
    const tableBody = h(
      'div',
      {
        class:
          'rating3-table-body'
      },
      EDU.skeleton(5)
    );
    const resultCount = h(
      'span',
      {
        class:
          'rating3-result-count'
      },
      ''
    );
    const periodSel = h(
      'select',
      {
        class:
          'rating3-select',
        onchange: () => {
          period =
            +periodSel.value;
          load();
        }
      },
      ...meta.periods.map(
        p =>
          h(
            'option',
            {
              value:
                p.period_id
            },
            `${p.academic_year}, ${p.semester} семестр`
          )
      )
    );
    periodSel.value =
      String(period);
    const groupSel = h(
      'select',
      {
        class:
          'rating3-select',
        onchange: () => {
          group =
            groupSel.value;
          load();
        }
      },
      h(
        'option',
        {
          value: ''
        },
        'Все группы'
      ),
      ...meta.groups.map(
        g =>
          h(
            'option',
            {
              value:
                g.group_id
            },
            g.code
          )
      )
    );
    const recalcButton =
      isStaff
        ? h(
            'button',
            {
              type:
                'button',
              class:
                'btn ghost rating3-recalc',
              onclick:
                async (ev) => {
                  const button =
                    ev.currentTarget;
                  button.disabled =
                    true;
                  const oldText =
                    button.textContent;
                  button.textContent =
                    'Пересчёт…';
                  try {
                    await EDU.api(
                      '/rating/recalculate?period_id=' +
                      period,
                      {
                        method:
                          'POST'
                      }
                    );
                    EDU.toast(
                      'Рейтинг пересчитан',
                      'ok'
                    );
                    await load();
                  }
                  catch (e) {
                    EDU.toast(
                      e.message,
                      'err'
                    );
                  }
                  finally {
                    button.disabled =
                      false;
                    button.textContent =
                      oldText;
                  }
                }
            },
            'Пересчитать рейтинг'
          )
        : null;
    host.replaceChildren(
      h(
        'section',
        {
          class:
            'rating3-hero'
        },
        h(
          'div',
          {
            class:
              'rating3-hero-copy'
          },
          h(
            'span',
            {
              class:
                'rating3-kicker'
            },
            isStudent
              ? 'Моя позиция'
              : 'Учебный рейтинг'
          ),
          h(
            'h1',
            {},
            'Рейтинг'
          ),
          h(
            'p',
            {},
            'Баллы начисляются за подтверждённые достижения. Равные баллы дают равные места.'
          )
        ),
        heroStats
      ),
      h(
        'section',
        {
          class:
            'rating3-controls'
        },
        h(
          'div',
          {
            class:
              'rating3-control'
          },
          h(
            'label',
            {},
            'Учебный период'
          ),
          periodSel
        ),
        h(
          'div',
          {
            class:
              'rating3-control'
          },
          h(
            'label',
            {},
            'Группа'
          ),
          groupSel
        ),
        recalcButton
      ),
      h(
        'section',
        {
          class:
            'rating3-panel'
        },
        h(
          'div',
          {
            class:
              'rating3-panel-head'
          },
          h(
            'div',
            {},
            h(
              'span',
              {
                class:
                  'rating3-eyebrow'
              },
              'Общий список'
            ),
            h(
              'h2',
              {},
              'Рейтинг студентов'
            )
          ),
          resultCount
        ),
        tableBody
      )
    );
    async function load() {
      tableBody.replaceChildren(
        EDU.skeleton(5)
      );
      const query =
        new URLSearchParams({
          period_id:
            period
        });
      if (group) {
        query.set(
          'group_id',
          group
        );
      }
      const [
        tableData,
        mine
      ] =
        await Promise.all([
          EDU.api(
            '/rating?' +
            query.toString()
          ),
          isStudent
            ? EDU.api(
                '/rating/me?period_id=' +
                period
              )
            : null
        ]);
      const rows =
        tableData.rows || [];
      if (mine) {
        heroStats.replaceChildren(
          h(
            'div',
            {
              class:
                'rating3-stat primary'
            },
            h(
              'span',
              {},
              'Мои баллы'
            ),
            h(
              'strong',
              {},
              EDU.pts(
                mine.total_points
              )
            )
          ),
          h(
            'div',
            {
              class:
                'rating3-stat'
            },
            h(
              'span',
              {},
              'В группе'
            ),
            h(
              'strong',
              {},
              mine.rank_in_group
                ? `${mine.rank_in_group} / ${mine.group_size}`
                : '—'
            )
          ),
          h(
            'div',
            {
              class:
                'rating3-stat'
            },
            h(
              'span',
              {},
              'На направлении'
            ),
            h(
              'strong',
              {},
              mine.rank_in_direction ??
                '—'
            )
          )
        );
      }
      else {
        heroStats.replaceChildren(
          h(
            'div',
            {
              class:
                'rating3-staff-summary'
            },
            h(
              'span',
              {},
              'В таблице'
            ),
            h(
              'strong',
              {},
              String(
                rows.length
              )
            ),
            h(
              'small',
              {},
              rows.length === 1
                ? 'студент'
                : 'студентов'
            )
          )
        );
      }
      resultCount.textContent =
        rows.length
          ? `Записей: ${rows.length}`
          : 'Нет записей';
      if (!rows.length) {
        tableBody.replaceChildren(
          h(
            'div',
            {
              class:
                'rating3-empty'
            },
            h(
              'strong',
              {},
              'Рейтинг пока не сформирован'
            ),
            h(
              'span',
              {},
              'Он появится после первого подтверждённого достижения за выбранный период.'
            )
          )
        );
        return;
      }
      const table =
        h(
          'table',
          {
            class:
              'rating3-table'
          },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h(
                'th',
                {
                  class:
                    'rating3-place-col'
                },
                'Место'
              ),
              h(
                'th',
                {},
                'Студент'
              ),
              h(
                'th',
                {},
                'Группа'
              ),
              h(
                'th',
                {},
                'Направление'
              ),
              h(
                'th',
                {
                  class:
                    'rating3-number'
                },
                'Баллы'
              ),
              h(
                'th',
                {
                  class:
                    'rating3-number'
                },
                'В группе'
              ),
              h(
                'th',
                {
                  class:
                    'rating3-number'
                },
                'На направлении'
              )
            )
          ),
          h(
            'tbody',
            {},
            ...rows.map(
              (r, i) => {
                const place =
                  i + 1;
                const isMe =
                  r.student_id ===
                  me.student_id;
                const rowClass = [
                  isMe
                    ? 'me'
                    : '',
                  place <= 3
                    ? `top place-${place}`
                    : ''
                ]
                  .filter(Boolean)
                  .join(' ');
                const studentName =
                  canOpenStudent
                    ? h(
                        'a',
                        {
                          href: '#',
                          onclick:
                            (e) => {
                              e.preventDefault();
                              EDU.show(
                                'review',
                                {
                                  student: {
                                    id:
                                      r.student_id,
                                    name:
                                      EDU.shortName(
                                        r.student_name
                                      )
                                  }
                                }
                              );
                            }
                        },
                        r.student_name
                      )
                    : h(
                        'span',
                        {},
                        r.student_name
                      );
                return h(
                  'tr',
                  {
                    class:
                      rowClass
                  },
                  h(
                    'td',
                    {
                      class:
                        'rating3-place'
                    },
                    h(
                      'span',
                      {},
                      String(place)
                    )
                  ),
                  h(
                    'td',
                    {
                      class:
                        'rating3-student'
                    },
                    studentName,
                    h(
                      'div',
                      {
                        class:
                          'rating3-student-meta'
                      },
                      `зачётка ${r.record_book_no}`,
                      r.student_status ===
                      'expelled'
                        ? h(
                            'span',
                            {
                              class:
                                'rating3-expelled'
                            },
                            'отчислен'
                          )
                        : null
                    )
                  ),
                  h(
                    'td',
                    {
                      class:
                        'rating3-nowrap'
                    },
                    r.group_name
                  ),
                  h(
                    'td',
                    {
                      class:
                        'rating3-direction'
                    },
                    r.direction_name
                  ),
                  h(
                    'td',
                    {
                      class:
                        'rating3-number rating3-points'
                    },
                    EDU.pts(
                      r.total_points
                    )
                  ),
                  h(
                    'td',
                    {
                      class:
                        'rating3-number'
                    },
                    String(
                      r.rank_in_group ??
                      '—'
                    )
                  ),
                  h(
                    'td',
                    {
                      class:
                        'rating3-number'
                    },
                    String(
                      r.rank_in_direction ??
                      '—'
                    )
                  )
                );
              }
            )
          )
        );
      tableBody.replaceChildren(
        h(
          'div',
          {
            class:
              'rating3-table-wrap'
          },
          table
        )
      );
    }
    await load();
  }
});
