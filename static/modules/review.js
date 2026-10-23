EDU.registerModule('review', {
  async render(host, _m, arg = {}) {
    const { h } = EDU;
    const canAct =
      EDU.me.role === 'staff';
    const tabs = [
      ['under review', 'На проверке'],
      ['confirmed', 'Подтверждено'],
      ['rejected', 'Отклонено'],
      ['', 'Все']
    ];
    let active =
      'under review';
    let q = '';
    let student =
      arg.student || null;
    let timer;
    const filters =
      h(
        'div',
        {
          class:
            'review3-filters'
        }
      );
    const studentFilter =
      h(
        'div',
        {
          class:
            'review3-student-filter'
        }
      );
    const countLabel =
      h(
        'span',
        {
          class:
            'review3-count'
        },
        ''
      );
    const body =
      h(
        'div',
        {
          class:
            'review3-body'
        },
        EDU.skeleton(4)
      );
    const search =
      h(
        'div',
        {
          class:
            'review3-search'
        },
        h(
          'span',
          {
            class:
              'review3-search-icon',
            'aria-hidden':
              'true'
          },
          '⌕'
        ),
        h(
          'input',
          {
            type:
              'text',
            placeholder:
              'Студент или название достижения',
            oninput:
              (e) => {
                clearTimeout(timer);
                timer =
                  setTimeout(
                    () => {
                      q =
                        e.target.value;
                      load();
                    },
                    250
                  );
              }
          }
        )
      );
    function drawFilters() {
      filters.replaceChildren(
        ...tabs.map(
          ([status, title]) =>
            h(
              'button',
              {
                type:
                  'button',
                class:
                  'review3-filter' +
                  (
                    active === status
                      ? ' active'
                      : ''
                  ),
                onclick:
                  () => {
                    active =
                      status;
                    drawFilters();
                    load();
                  }
              },
              title
            )
        )
      );
      studentFilter.replaceChildren(
        student
          ? h(
              'button',
              {
                type:
                  'button',
                class:
                  'review3-student-chip',
                onclick:
                  () => {
                    student =
                      null;
                    drawFilters();
                    load();
                  }
              },
              h(
                'span',
                {},
                'Студент:'
              ),
              h(
                'b',
                {},
                student.name
              ),
              h(
                'i',
                {
                  'aria-hidden':
                    'true'
                },
                '×'
              )
            )
          : ''
      );
    }
    const actionsFor =
      (achievement) => {
        if (
          !canAct ||
          achievement.status !==
            'under review'
        ) {
          return '';
        }
        const reject =
          h(
            'button',
            {
              type:
                'button',
              class:
                'review3-action reject',
              onclick:
                async (e) => {
                  e.stopPropagation();
                  const ok =
                    await EDU.rejectDialog(
                      achievement.achievement_id
                    );
                  if (!ok) {
                    return;
                  }
                  EDU.toast(
                    'Достижение отклонено'
                  );
                  load();
                }
            },
            'Отклонить'
          );
        const confirm =
          h(
            'button',
            {
              type:
                'button',
              class:
                'review3-action confirm',
              onclick:
                async (e) => {
                  e.stopPropagation();
                  const button =
                    e.currentTarget;
                  button.disabled =
                    true;
                  try {
                    const result =
                      await EDU.api(
                        `/review/${achievement.achievement_id}/confirm`,
                        {
                          method:
                            'POST'
                        }
                      );
                    EDU.toast(
                      `Подтверждено: ${achievement.student_name}, +${EDU.pts(result.points)} б.`,
                      'ok'
                    );
                    await load();
                  }
                  catch (err) {
                    EDU.toast(
                      err.message,
                      'err'
                    );
                    button.disabled =
                      false;
                  }
                }
            },
            'Подтвердить'
          );
        return h(
          'span',
          {
            class:
              'review3-actions',
            onclick:
              (e) =>
                e.stopPropagation()
          },
          reject,
          confirm
        );
      };
    async function load() {
      const params =
        new URLSearchParams();
      if (active) {
        params.set(
          'status',
          active
        );
      }
      if (q.trim()) {
        params.set(
          'q',
          q.trim()
        );
      }
      if (student) {
        params.set(
          'student_id',
          student.id
        );
      }
      body.replaceChildren(
        EDU.skeleton(3)
      );
      try {
        const rows =
          await EDU.api(
            '/review/list?' +
            params.toString()
          );
        countLabel.textContent =
          rows.length === 300
            ? 'Показаны первые 300 записей'
            : `Записей: ${rows.length}`;
        body.replaceChildren(
          rows.length
            ? h(
                'div',
                {
                  class:
                    'timeline review3-timeline'
                },
                ...rows.map(
                  a =>
                    EDU.achRow(
                      a,
                      {
                        who:
                          true,
                        actions:
                          actionsFor(a),
                        onclick:
                          () =>
                            EDU.openAchievement(
                              a.achievement_id,
                              load
                            )
                      }
                    )
                )
              )
            : h(
                'div',
                {
                  class:
                    'review3-empty'
                },
                h(
                  'div',
                  {
                    class:
                      'review3-empty-mark'
                  },
                  '✓'
                ),
                h(
                  'strong',
                  {},
                  active ===
                    'under review' &&
                  !q &&
                  !student
                    ? 'Очередь пуста'
                    : 'Ничего не найдено'
                ),
                h(
                  'span',
                  {},
                  active ===
                    'under review' &&
                  !q &&
                  !student
                    ? 'Все поступившие достижения уже обработаны.'
                    : 'Попробуйте изменить статус, поиск или фильтр по студенту.'
                )
              )
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
            'review3-hero'
        },
        h(
          'div',
          {
            class:
              'review3-hero-copy'
          },
          h(
            'span',
            {
              class:
                'review3-kicker'
            },
            canAct
              ? 'Рабочая очередь'
              : 'Режим просмотра'
          ),
          h(
            'h1',
            {},
            'Проверка достижений'
          ),
          h(
            'p',
            {},
            canAct
              ? 'Проверьте сведения и подтверждающие документы. Подтверждение начисляет баллы и обновляет рейтинг.'
              : 'Просмотр заявок студентов без возможности подтверждения и отклонения.'
          )
        ),
        h(
          'div',
          {
            class:
              'review3-flow'
          },
          h(
            'div',
            {
              class:
                'review3-flow-step'
            },
            h(
              'b',
              {},
              '01'
            ),
            h(
              'span',
              {},
              'Открыть заявку'
            )
          ),
          h(
            'i',
            {},
            '→'
          ),
          h(
            'div',
            {
              class:
                'review3-flow-step'
            },
            h(
              'b',
              {},
              '02'
            ),
            h(
              'span',
              {},
              'Проверить данные'
            )
          ),
          h(
            'i',
            {},
            '→'
          ),
          h(
            'div',
            {
              class:
                'review3-flow-step'
            },
            h(
              'b',
              {},
              '03'
            ),
            h(
              'span',
              {},
              canAct
                ? 'Принять решение'
                : 'Просмотреть'
            )
          )
        )
      ),
      h(
        'section',
        {
          class:
            'review3-panel'
        },
        h(
          'div',
          {
            class:
              'review3-panel-head'
          },
          h(
            'div',
            {},
            h(
              'span',
              {
                class:
                  'review3-eyebrow'
              },
              'Реестр'
            ),
            h(
              'h2',
              {},
              'Заявки студентов'
            )
          ),
          countLabel
        ),
        h(
          'div',
          {
            class:
              'review3-toolbar'
          },
          h(
            'div',
            {
              class:
                'review3-toolbar-left'
            },
            filters,
            studentFilter
          ),
          search
        ),
        body
      )
    );
    drawFilters();
    await load();
  }
});
