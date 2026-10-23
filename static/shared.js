(() => {
  const { h } = EDU, L = EDU.L;
  EDU.achRow = (a, { who = false, onclick, actions } = {}) => {
    const d = EDU.date(a.achieved_on);
    const sub = [who ? a.student_name : null, who ? a.group_name : null, L.kindShort[a.kind], EDU.lbl('category', a.category)].filter(Boolean).join(' · ');
    return h('div', { class: 'dl click status-' + a.status.replace(' ', '-'), onclick },
      h('div', { class: 'date' }, h('b', {}, String(d.getDate())), h('span', {}, d.toLocaleString('ru-RU', { month: 'short' }).replace('.', ''))),
      h('div', {}, h('div', { class: 'title' }, a.title), h('div', { class: 'sub' }, sub)),
      h('div', { class: 'row' }, a.status === 'confirmed' ? EDU.chip('+' + EDU.pts(a.points), 'ok') : '', EDU.statusChip(a.status), actions || ''));
  };
  EDU.eventRow = (e) => {
    const d = EDU.date(e.start_date), n = EDU.daysFrom(e.start_date), ongoing = n < 0 && EDU.daysFrom(e.end_date) >= 0;
    const rel = ongoing ? { text: 'идёт сейчас', tone: 'warn' } : EDU.relativeDays(n);
    const sub = [EDU.lbl('event_type', e.event_type), EDU.lbl('level', e.level), e.place, e.organization, e.parent_title && `в составе: ${e.parent_title}`].filter(Boolean).join(' · ');
    return h('div', { class: 'dl t-' + e.event_type },
      h('div', { class: 'date' }, h('b', {}, String(d.getDate())), h('span', {}, d.toLocaleString('ru-RU', { month: 'short' }).replace('.', ''))),
      h('div', {}, h('div', { class: 'title' }, e.title), h('div', { class: 'sub' }, sub)),
      rel.text === 'прошло' ? EDU.chip(EDU.lbl('level', e.level)) : EDU.chip(rel.text, rel.tone));
  };
  EDU.rejectDialog = (id) =>
  new Promise((resolve) => {
    const m = EDU.modal({
      title: 'Отклонить достижение',
      center: true
    });
    m.body.classList.add('reject3-body');
    const text = h(
      'textarea',
      {
        class: 'reject3-textarea',
        placeholder:
          'Опишите причину отклонения — студент увидит этот комментарий.'
      }
    );
    const counter = h(
      'span',
      {
        class: 'reject3-counter'
      },
      '0 символов'
    );
    const err = h(
      'div',
      {
        class:
          'form-err reject3-error'
      }
    );
    text.addEventListener(
      'input',
      () => {
        counter.textContent =
          `${text.value.length} символов`;
        err.textContent = '';
      }
    );
    const done = value => {
      m.close();
      resolve(value);
    };
    const cancel = h(
      'button',
      {
        type: 'button',
        class:
          'btn ghost',
        onclick:
          () => done(null)
      },
      'Отмена'
    );
    const reject = h(
      'button',
      {
        type: 'button',
        class:
          'btn danger reject3-submit',
        onclick:
          async e => {
            const comment =
              text.value.trim();
            if (!comment) {
              err.textContent =
                'Укажите причину отклонения';
              text.focus();
              return;
            }
            e.currentTarget.disabled =
              true;
            try {
              const result =
                await EDU.api(
                  `/review/${id}/reject`,
                  {
                    method: 'POST',
                    body: {
                      comment
                    }
                  }
                );
              done(result);
            }
            catch (error) {
              err.textContent =
                error.message;
              e.currentTarget.disabled =
                false;
            }
          }
      },
      'Отклонить достижение'
    );
    m.body.replaceChildren(
      h(
        'div',
        {
          class: 'reject3-intro'
        },
        h(
          'div',
          {
            class: 'reject3-icon'
          },
          '!'
        ),
        h(
          'div',
          {},
          h(
            'strong',
            {},
            'Укажите причину'
          ),
          h(
            'p',
            {},
            'Комментарий будет доступен студенту после отклонения заявки.'
          )
        )
      ),
      h(
        'div',
        {
          class: 'reject3-field'
        },
        h(
          'div',
          {
            class: 'reject3-label'
          },
          h(
            'label',
            {},
            'Комментарий'
          ),
          counter
        ),
        text,
        h(
          'p',
          {
            class: 'reject3-hint'
          },
          'Например: не приложен подтверждающий документ или данные в заявке не соответствуют документу.'
        )
      ),
      err,
      h(
        'div',
        {
          class: 'reject3-actions'
        },
        cancel,
        reject
      )
    );
    text.focus();
  });
  function documentFields(ref) {
    const type = h('select', {}, ref.enums.doc_types.map(t => h('option', { value: t }, L.doc_type[t] || t)));
    const file = h('input', { type: 'text', placeholder: 'Ссылка или путь к скану, например /documents/diploma.pdf' });
    const num = h('input', { type: 'text', placeholder: 'Номер документа (если есть)' });
    const date = h('input', { type: 'date' });
    const node = h('div', { class: 'fields' },
      h('div', { class: 'field' }, h('label', {}, 'Вид документа'), type),
      h('div', { class: 'field' }, h('label', {}, 'Дата выдачи'), date),
      h('div', { class: 'field full' }, h('label', {}, 'Ссылка на файл'), file),
      h('div', { class: 'field full' }, h('label', {}, 'Номер документа'), num));
    const value = () => file.value.trim() ? { doc_type: type.value, file_ref: file.value.trim(), doc_number: num.value.trim() || null, issued_on: date.value || null } : null;
    return { node, value };
  }
  async function addDocumentDialog(id, done) {
  const ref =
    await EDU.api(
      '/achievements/reference'
    );
  const m = EDU.modal({
    title: 'Добавить документ',
    center: true
  });
  m.body.classList.add(
    'docadd3-body'
  );
  const f =
    documentFields(ref);
  const err = h(
    'div',
    {
      class:
        'form-err docadd3-error'
    }
  );
  const formBox = h(
    'div',
    {
      class:
        'docadd3-form'
    },
    f.node
  );
  const cancelButton = h(
    'button',
    {
      type:
        'button',
      class:
        'btn ghost',
      onclick:
        m.close
    },
    'Отмена'
  );
  const addButton = h(
    'button',
    {
      type:
        'button',
      class:
        'btn docadd3-submit',
      onclick:
        async (ev) => {
          err.textContent = '';
          const doc =
            f.value();
          if (!doc) {
            err.textContent =
              'Укажите ссылку или путь к документу';
            return;
          }
          ev.currentTarget.disabled =
            true;
          cancelButton.disabled =
            true;
          try {
            await EDU.api(
              `/achievements/${id}/documents`,
              {
                method:
                  'POST',
                body: {
                  document:
                    doc
                }
              }
            );
            EDU.toast(
              'Документ добавлен',
              'ok'
            );
            m.close();
            await done();
          }
          catch (e) {
            err.textContent =
              e.message;
            ev.currentTarget.disabled =
              false;
            cancelButton.disabled =
              false;
          }
        }
    },
    'Добавить документ'
  );
  m.body.replaceChildren(
    h(
      'div',
      {
        class:
          'docadd3-intro'
      },
      h(
        'div',
        {
          class:
            'docadd3-icon'
        },
        EDU.icon(
          'file',
          22
        )
      ),
      h(
        'div',
        {},
        h(
          'strong',
          {},
          'Подтверждающий документ'
        ),
        h(
          'p',
          {},
          'Добавьте сведения о документе, который подтверждает достижение.'
        )
      )
    ),
    formBox,
    h(
      'div',
      {
        class:
          'docadd3-note'
      },
      h(
        'span',
        {},
        'i'
      ),
      h(
        'p',
        {},
        'Файл не загружается в систему. Укажите ссылку или путь к скану документа.'
      )
    ),
    err,
    h(
      'div',
      {
        class:
          'docadd3-actions'
      },
      cancelButton,
      addButton
    )
  );
}
EDU.openAchievement = async (id, onChange = () => {}) => {
  const m = EDU.modal({
    title: 'Достижение',
    wide: true
  });
  m.body.classList.add('achview3-body');
  m.body.append(EDU.skeleton(2));
  const reload = async () => {
    const data =
      await EDU.api(
        '/achievements/' + id
      );
    draw(data);
  };
  const changed = async (data) => {
    onChange();
    if (data) {
      draw(data);
    } else {
      await reload();
    }
  };
  function getFacts(a) {
    const d =
      a.details || {};
    const rows = [];
    const add = (label, value) => {
      if (
        value !== null &&
        value !== undefined &&
        value !== ''
      ) {
        rows.push([
          label,
          value
        ]);
      }
    };
    if (a.kind === 'participation') {
      add(
        'Мероприятие',
        d.event_title
      );
      add(
        'Тип',
        EDU.lbl(
          'event_type',
          d.event_type
        )
      );
      add(
        'Уровень',
        EDU.lbl(
          'level',
          d.level
        )
      );
      if (d.start_date) {
        add(
          'Даты',
          d.end_date &&
          d.end_date !==
            d.start_date
            ? `${EDU.fmtDate(
                d.start_date
              )} — ${EDU.fmtDate(
                d.end_date
              )}`
            : EDU.fmtDate(
                d.start_date
              )
        );
      }
      add(
        'Место проведения',
        d.place
      );
      add(
        'Роль',
        EDU.lbl(
          'role',
          d.role
        )
      );
      add(
        'Результат',
        EDU.lbl(
          'result',
          d.result
        )
      );
    }
    else if (a.kind === 'authorship') {
      add(
        'Публикация',
        d.publication_title
      );
      if (d.source) {
        add(
          'Издание',
          d.source_type
            ? `${d.source} (${EDU.lbl(
                'source_type',
                d.source_type
              )})`
            : d.source
        );
      }
      add(
        'Уровень издания',
        EDU.lbl(
          'level',
          d.level
        )
      );
      if (d.published_on) {
        add(
          'Дата публикации',
          EDU.fmtDate(
            d.published_on
          )
        );
      }
      add(
        'DOI',
        d.doi
      );
      add(
        'Страницы',
        d.pages
      );
      add(
        'Номер автора',
        d.author_order
      );
      add(
        'Научный руководитель',
        d.supervisor
      );
    }
    else {
      add(
        'Организация',
        d.organization
      );
      add(
        'Тип организации',
        EDU.lbl(
          'org_type',
          d.org_type
        )
      );
      add(
        'Должность',
        d.position
      );
      if (d.joined_on) {
        add(
          'Вступил',
          EDU.fmtDate(
            d.joined_on
          )
        );
      }
      if (d.left_on) {
        add(
          'Вышел',
          EDU.fmtDate(
            d.left_on
          )
        );
      }
    }
    return rows;
  }
  function draw(a) {
    const me =
      EDU.me;
    const mine =
      me.role === 'student';
    const isStaff =
      me.role === 'staff';
    const facts =
      getFacts(a);
    const documents =
      a.documents || [];
    const statusClass =
      String(a.status || '')
        .replaceAll(' ', '-');
    const points =
      a.points == null
        ? '—'
        : EDU.pts(a.points);
    let statusNote = '';
    if (a.status === 'confirmed') {
      statusNote = h(
        'div',
        {
          class:
            'achview3-note confirmed'
        },
        h(
          'span',
          {
            class:
              'achview3-note-icon'
          },
          '✓'
        ),
        h(
          'div',
          {},
          h(
            'strong',
            {},
            'Достижение подтверждено'
          ),
          h(
            'p',
            {},
            `Проверил(а): ${
              a.reviewer_name ||
              'сотрудник деканата'
            }${
              a.verified_at
                ? `, ${EDU.fmtDate(
                    a.verified_at
                  )}`
                : ''
            }. Начислено ${points} б.`
          )
        )
      );
    }
    else if (
      a.status === 'rejected'
    ) {
      statusNote = h(
        'div',
        {
          class:
            'achview3-note rejected'
        },
        h(
          'span',
          {
            class:
              'achview3-note-icon'
          },
          '!'
        ),
        h(
          'div',
          {},
          h(
            'strong',
            {},
            'Достижение отклонено'
          ),
          h(
            'p',
            {},
            a.reviewer_comment ||
            'Причина отклонения не указана.'
          )
        )
      );
    }
    else if (
      a.status === 'draft'
    ) {
      statusNote = h(
        'div',
        {
          class:
            'achview3-note draft'
        },
        h(
          'span',
          {
            class:
              'achview3-note-icon'
          },
          'i'
        ),
        h(
          'div',
          {},
          h(
            'strong',
            {},
            'Это черновик'
          ),
          h(
            'p',
            {},
            'Черновик виден только вам. Добавьте подтверждающий документ и отправьте заявку на проверку.'
          )
        )
      );
    }
    else if (
      a.status === 'under review'
    ) {
      statusNote = h(
        'div',
        {
          class:
            'achview3-note review'
        },
        h(
          'span',
          {
            class:
              'achview3-note-icon'
          },
          '…'
        ),
        h(
          'div',
          {},
          h(
            'strong',
            {},
            'Заявка находится на проверке'
          ),
          h(
            'p',
            {},
            'Решение по заявке ещё не принято.'
          )
        )
      );
    }
    const docsBlock =
      documents.length
        ? h(
            'div',
            {
              class:
                'achview3-doc-list'
            },
            ...documents.map(
              doc =>
                h(
                  'div',
                  {
                    class:
                      'achview3-doc'
                  },
                  h(
                    'div',
                    {
                      class:
                        'achview3-doc-icon'
                    },
                    EDU.icon(
                      'file',
                      20
                    )
                  ),
                  h(
                    'div',
                    {
                      class:
                        'achview3-doc-main'
                    },
                    h(
                      'strong',
                      {},
                      EDU.lbl(
                        'doc_type',
                        doc.doc_type
                      ) +
                      (
                        doc.doc_number
                          ? ` № ${doc.doc_number}`
                          : ''
                      )
                    ),
                    /^https?:\/\//.test(
                      doc.file_ref
                    )
                      ? h(
                          'a',
                          {
                            href:
                              doc.file_ref,
                            target:
                              '_blank',
                            rel:
                              'noopener'
                          },
                          doc.file_ref
                        )
                      : h(
                          'span',
                          {},
                          doc.file_ref
                        )
                  ),
                  doc.issued_on
                    ? h(
                        'span',
                        {
                          class:
                            'achview3-doc-date'
                        },
                        EDU.fmtDate(
                          doc.issued_on
                        )
                      )
                    : ''
                )
            )
          )
        : h(
            'div',
            {
              class:
                'achview3-doc-empty'
            },
            h(
              'span',
              {},
              'Документов пока нет'
            )
          );
    const buttons = [];
    if (
      mine &&
      a.status === 'draft'
    ) {
      buttons.push(
        h(
          'button',
          {
            type:
              'button',
            class:
              'btn ghost',
            onclick:
              () =>
                addDocumentDialog(
                  id,
                  reload
                )
          },
          'Добавить документ'
        ),
        h(
          'button',
          {
            type:
              'button',
            class:
              'btn danger',
            onclick:
              async () => {
                const yes =
                  await EDU.confirm({
                    title:
                      'Удалить черновик?',
                    text:
                      a.title,
                    ok:
                      'Удалить',
                    danger:
                      true
                  });
                if (!yes) {
                  return;
                }
                try {
                  await EDU.api(
                    '/achievements/' +
                    id,
                    {
                      method:
                        'DELETE'
                    }
                  );
                  EDU.toast(
                    'Черновик удалён',
                    'ok'
                  );
                  onChange();
                  m.close();
                }
                catch (e) {
                  EDU.toast(
                    e.message,
                    'err'
                  );
                }
              }
          },
          'Удалить'
        ),
        h(
          'button',
          {
            type:
              'button',
            class:
              'btn',
            onclick:
              async (ev) => {
                const button =
                  ev.currentTarget;
                button.disabled =
                  true;
                try {
                  await EDU.api(
                    `/achievements/${id}/submit`,
                    {
                      method:
                        'POST'
                    }
                  );
                  EDU.toast(
                    'Отправлено на проверку',
                    'ok'
                  );
                  await changed();
                }
                catch (e) {
                  EDU.toast(
                    e.message,
                    'err'
                  );
                  button.disabled =
                    false;
                }
              }
          },
          'Отправить на проверку'
        )
      );
    }
    if (
      isStaff &&
      a.status === 'under review'
    ) {
      buttons.push(
        h(
          'button',
          {
            type:
              'button',
            class:
              'btn danger',
            onclick:
              async () => {
                const result =
                  await EDU.rejectDialog(
                    id
                  );
                if (result) {
                  EDU.toast(
                    'Достижение отклонено'
                  );
                  await changed(
                    result
                  );
                }
              }
          },
          'Отклонить'
        ),
        h(
          'button',
          {
            type:
              'button',
            class:
              'btn',
            onclick:
              async (ev) => {
                const button =
                  ev.currentTarget;
                button.disabled =
                  true;
                try {
                  const result =
                    await EDU.api(
                      `/review/${id}/confirm`,
                      {
                        method:
                          'POST'
                      }
                    );
                  EDU.toast(
                    `Подтверждено, начислено ${EDU.pts(
                      result.points
                    )} б.`,
                    'ok'
                  );
                  await changed(
                    result
                  );
                }
                catch (e) {
                  EDU.toast(
                    e.message,
                    'err'
                  );
                  button.disabled =
                    false;
                }
              }
          },
          'Подтвердить'
        )
      );
    }
    m.setTitle(
      'Достижение'
    );
    m.body.replaceChildren(
      h(
        'section',
        {
          class:
            'achview3-hero'
        },
        h(
          'div',
          {
            class:
              'achview3-hero-main'
          },
          h(
            'div',
            {
              class:
                'achview3-tags'
            },
            h(
              'span',
              {
                class:
                  'achview3-kind'
              },
              EDU.lbl(
                'kindShort',
                a.kind
              )
            ),
            h(
              'span',
              {
                class:
                  'achview3-category'
              },
              EDU.lbl(
                'category',
                a.category
              )
            )
          ),
          h(
            'h2',
            {},
            a.title
          ),
          !mine
            ? h(
                'div',
                {
                  class:
                    'achview3-student'
                },
                h(
                  'strong',
                  {},
                  a.student_name
                ),
                h(
                  'span',
                  {},
                  [
                    a.group_name,
                    a.record_book_no
                      ? `зачётка ${a.record_book_no}`
                      : null
                  ]
                    .filter(Boolean)
                    .join(' · ')
                )
              )
            : ''
        ),
        h(
          'div',
          {
            class:
              'achview3-summary'
          },
          h(
            'div',
            {
              class:
                `achview3-summary-status ${statusClass}`
            },
            h(
              'span',
              {},
              'Статус'
            ),
            h(
              'strong',
              {},
              EDU.lbl(
                'status',
                a.status
              )
            )
          ),
          h(
            'div',
            {
              class:
                'achview3-summary-cell points'
            },
            h(
              'span',
              {},
              'Баллы'
            ),
            h(
              'strong',
              {},
              points
            )
          )
        )
      ),
      h(
        'div',
        {
          class:
            'achview3-meta'
        },
        h(
          'div',
          {},
          h(
            'span',
            {},
            'Дата достижения'
          ),
          h(
            'strong',
            {},
            EDU.fmtDate(
              a.achieved_on
            )
          )
        ),
        h(
          'div',
          {},
          h(
            'span',
            {},
            'Категория'
          ),
          h(
            'strong',
            {},
            EDU.lbl(
              'category',
              a.category
            )
          )
        ),
        h(
          'div',
          {},
          h(
            'span',
            {},
            'Учебный период'
          ),
          h(
            'strong',
            {},
            `${a.academic_year}, ${a.semester} сем.`
          )
        )
      ),
      statusNote,
      h(
        'div',
        {
          class:
            'achview3-grid'
        },
        h(
          'section',
          {
            class:
              'achview3-card'
          },
          h(
            'div',
            {
              class:
                'achview3-card-head'
            },
            h(
              'span',
              {},
              '01'
            ),
            h(
              'div',
              {},
              h(
                'small',
                {},
                'Сведения'
              ),
              h(
                'h3',
                {},
                'Детали достижения'
              )
            )
          ),
          facts.length
            ? h(
                'div',
                {
                  class:
                    'achview3-facts'
                },
                ...facts.map(
                  ([label, value]) =>
                    h(
                      'div',
                      {
                        class:
                          'achview3-fact'
                      },
                      h(
                        'span',
                        {},
                        label
                      ),
                      h(
                        'strong',
                        {},
                        String(value)
                      )
                    )
                )
              )
            : h(
                'div',
                {
                  class:
                    'achview3-empty'
                },
                'Дополнительных сведений нет'
              )
        ),
        h(
          'section',
          {
            class:
              'achview3-card'
          },
          h(
            'div',
            {
              class:
                'achview3-card-head'
            },
            h(
              'span',
              {},
              '02'
            ),
            h(
              'div',
              {},
              h(
                'small',
                {},
                'Подтверждение'
              ),
              h(
                'h3',
                {},
                'Документы'
              )
            )
          ),
          docsBlock
        )
      ),
      buttons.length
        ? h(
            'div',
            {
              class:
                'achview3-actions'
            },
            ...buttons
          )
        : ''
    );
  }
  try {
    await reload();
  }
  catch (e) {
    m.body.replaceChildren(
      h(
        'div',
        {
          class:
            'card err'
        },
        e.message
      )
    );
  }
};
EDU.newAchievement = async (onDone = () => {}) => {
  const m = EDU.modal({
    title: 'Новое достижение',
    wide: true
  });
  m.body.classList.add('newach3-body');
  m.body.append(
    EDU.skeleton(2)
  );
  let ref;
  try {
    ref = await EDU.api(
      '/achievements/reference'
    );
  } catch (e) {
    m.body.replaceChildren(
      h(
        'div',
        {
          class: 'card err'
        },
        e.message
      )
    );
    return;
  }
  const opt = (value, text) =>
    h(
      'option',
      { value },
      text
    );
  const select = (items, first = '') =>
    h(
      'select',
      {},
      first
        ? opt('', first)
        : '',
      ...items
    );
  const field = (
    label,
    input,
    full = false,
    hint = ''
  ) =>
    h(
      'div',
      {
        class:
          'newach3-field' +
          (full ? ' full' : '')
      },
      h(
        'label',
        {},
        label
      ),
      input,
      hint
        ? h(
            'small',
            {},
            hint
          )
        : ''
    );
  const sectionHead = (
    step,
    title,
    text
  ) =>
    h(
      'div',
      {
        class: 'newach3-section-head'
      },
      h(
        'span',
        {
          class: 'newach3-step'
        },
        step
      ),
      h(
        'div',
        {},
        h(
          'h3',
          {},
          title
        ),
        text
          ? h(
              'p',
              {},
              text
            )
          : ''
      )
    );
  const st = {
    kind: 'participation',
    pub: 'existing'
  };
  const title = h(
    'input',
    {
      type: 'text',
      placeholder:
        'Например: 1 место на студенческой конференции'
    }
  );
  const date = h(
    'input',
    {
      type: 'date',
      value: EDU.isoToday()
    }
  );
  const category = select(
    ref.categories.map(
      c =>
        opt(
          c.category_id,
          EDU.lbl(
            'category',
            c.name
          )
        )
    )
  );
  const kindBox = h(
    'div',
    {
      class: 'newach3-kind-body'
    }
  );
  const kindSeg = h(
    'div',
    {
      class: 'newach3-kind-tabs'
    },
    ...ref.enums.kinds.map(
      kind =>
        h(
          'button',
          {
            type: 'button',
            'data-k': kind,
            onclick: () => {
              st.kind = kind;
              drawKind();
            }
          },
          EDU.lbl(
            'kindShort',
            kind
          )
        )
    )
  );
  const doc =
    documentFields(ref);
  const err = h(
    'div',
    {
      class:
        'form-err newach3-error'
    }
  );
  let f = {};
  function drawKind() {
    [...kindSeg.children].forEach(
      button => {
        button.classList.toggle(
          'active',
          button.dataset.k === st.kind
        );
      }
    );
    f = {};
    if (st.kind === 'participation') {
      f.event = select(
        ref.events
          .filter(
            e =>
              e.start_date <=
              EDU.isoToday()
          )
          .map(
            e =>
              opt(
                e.event_id,
                `${e.title} · ${EDU.fmtDate(
                  e.start_date,
                  false
                )}`
              )
          )
      );
      f.role = select(
        ref.roles.map(
          r =>
            opt(
              r.role_id,
              EDU.lbl(
                'role',
                r.name
              )
            )
        )
      );
      f.result = select(
        ref.enums.results.map(
          r =>
            opt(
              r,
              EDU.lbl(
                'result',
                r
              )
            )
        )
      );
      if (
        ref.enums.results.includes(
          'no place'
        )
      ) {
        f.result.value =
          'no place';
      }
      kindBox.replaceChildren(
        h(
          'div',
          {
            class: 'newach3-fields'
          },
          field(
            'Мероприятие',
            f.event,
            true
          ),
          field(
            'Роль',
            f.role
          ),
          field(
            'Результат',
            f.result
          )
        )
      );
    }
    else if (st.kind === 'authorship') {
      f.order = h(
        'input',
        {
          type: 'number',
          min: 1,
          value: 1
        }
      );
      const mode = h(
        'div',
        {
          class: 'newach3-subtabs'
        },
        ...[
          [
            'existing',
            'Из списка'
          ],
          [
            'new',
            'Новая публикация'
          ]
        ].map(
          ([key, text]) =>
            h(
              'button',
              {
                type: 'button',
                class:
                  st.pub === key
                    ? 'active'
                    : '',
                onclick: () => {
                  st.pub = key;
                  drawKind();
                }
              },
              text
            )
        )
      );
      let publicationBody;
      if (st.pub === 'existing') {
        f.pubId = select(
          ref.publications.map(
            p =>
              opt(
                p.publication_id,
                `${p.title} · ${p.source}`
              )
          ),
          ref.publications.length
            ? ''
            : 'Публикаций пока нет'
        );
        publicationBody = h(
          'div',
          {
            class: 'newach3-fields'
          },
          field(
            'Публикация',
            f.pubId,
            true
          )
        );
      }
      else {
        f.pTitle = h(
          'input',
          {
            type: 'text',
            placeholder:
              'Название работы'
          }
        );
        f.pDate = h(
          'input',
          {
            type: 'date'
          }
        );
        f.source = select(
          ref.sources.map(
            s =>
              opt(
                s.source_id,
                `${s.name} · ${EDU.lbl(
                  'level',
                  s.level
                )}`
              )
          )
        );
        f.doi = h(
          'input',
          {
            type: 'text',
            placeholder:
              '10.1234/example'
          }
        );
        f.pages = h(
          'input',
          {
            type: 'text',
            placeholder:
              '15–22'
          }
        );
        f.sup = select(
          ref.supervisors.map(
            s =>
              opt(
                s.employee_id,
                s.full_name
              )
          ),
          'Без научного руководителя'
        );
        publicationBody = h(
          'div',
          {
            class: 'newach3-fields'
          },
          field(
            'Название публикации',
            f.pTitle,
            true
          ),
          field(
            'Дата публикации',
            f.pDate
          ),
          field(
            'Издание',
            f.source
          ),
          field(
            'DOI',
            f.doi
          ),
          field(
            'Страницы',
            f.pages
          ),
          field(
            'Научный руководитель',
            f.sup
          )
        );
      }
      kindBox.replaceChildren(
        mode,
        publicationBody,
        h(
          'div',
          {
            class:
              'newach3-fields compact'
          },
          field(
            'Номер в списке авторов',
            f.order
          )
        )
      );
    }
    else {
      f.org = select(
        ref.organizations.map(
          o =>
            opt(
              o.organization_id,
              `${o.name} · ${EDU.lbl(
                'org_type',
                o.org_type
              )}`
            )
        )
      );
      f.pos = h(
        'input',
        {
          type: 'text',
          value: 'participant',
          placeholder:
            'Должность или роль'
        }
      );
      f.from = h(
        'input',
        {
          type: 'date',
          value: date.value
        }
      );
      f.to = h(
        'input',
        {
          type: 'date'
        }
      );
      kindBox.replaceChildren(
        h(
          'div',
          {
            class: 'newach3-fields'
          },
          field(
            'Организация',
            f.org,
            true
          ),
          field(
            'Должность',
            f.pos
          ),
          field(
            'Вступил',
            f.from
          ),
          field(
            'Вышел',
            f.to,
            false,
            'Оставьте пустым, если членство продолжается'
          )
        )
      );
    }
  }
  function makeBody(submit) {
    const body = {
      kind: st.kind,
      title: title.value,
      achieved_on: date.value,
      category_id:
        +category.value,
      submit,
      document:
        doc.value()
    };
    if (st.kind === 'participation') {
      Object.assign(
        body,
        {
          event_id:
            +f.event.value,
          role_id:
            +f.role.value,
          result:
            f.result.value
        }
      );
    }
    else if (st.kind === 'authorship') {
      body.author_order =
        +f.order.value || 1;
      if (st.pub === 'existing') {
        body.publication_id =
          f.pubId.value
            ? +f.pubId.value
            : null;
      }
      else {
        body.publication = {
          title:
            f.pTitle.value,
          published_on:
            f.pDate.value ||
            null,
          source_id:
            +f.source.value,
          doi:
            f.doi.value.trim() ||
            null,
          pages:
            f.pages.value.trim() ||
            null,
          supervisor_id:
            f.sup.value
              ? +f.sup.value
              : null
        };
      }
    }
    else {
      Object.assign(
        body,
        {
          organization_id:
            +f.org.value,
          position:
            f.pos.value,
          joined_on:
            f.from.value ||
            null,
          left_on:
            f.to.value ||
            null
        }
      );
    }
    return body;
  }
  const send =
    submit =>
      async () => {
        err.textContent = '';
        if (!title.value.trim()) {
          err.textContent =
            'Заполните название достижения';
          title.focus();
          return;
        }
        if (!date.value) {
          err.textContent =
            'Укажите дату достижения';
          date.focus();
          return;
        }
        const buttons = [
          ...m.body.querySelectorAll(
            '.newach3-actions button'
          )
        ];
        buttons.forEach(
          button =>
            button.disabled =
              true
        );
        try {
          await EDU.api(
            '/achievements',
            {
              method: 'POST',
              body:
                makeBody(submit)
            }
          );
          EDU.toast(
            submit
              ? 'Отправлено на проверку'
              : 'Черновик сохранён',
            'ok'
          );
          m.close();
          onDone();
        }
        catch (e) {
          err.textContent =
            e.message;
          buttons.forEach(
            button =>
              button.disabled =
                false
          );
        }
      };
  drawKind();
  m.body.replaceChildren(
    h(
      'div',
      {
        class: 'newach3-intro'
      },
      h(
        'span',
        {
          class: 'newach3-kicker'
        },
        'Новая заявка'
      ),
      h(
        'div',
        {},
        h(
          'strong',
          {},
          'Добавьте сведения о достижении'
        ),
        h(
          'p',
          {},
          'Заполните данные и приложите подтверждающий документ.'
        )
      )
    ),
    h(
      'div',
      {
        class: 'newach3-layout'
      },
      h(
        'div',
        {
          class: 'newach3-main'
        },
        h(
          'section',
          {
            class: 'newach3-card'
          },
          sectionHead(
            '01',
            'Основные данные',
            'Название, дата и категория достижения.'
          ),
          h(
            'div',
            {
              class: 'newach3-fields'
            },
            field(
              'Название',
              title,
              true
            ),
            field(
              'Дата достижения',
              date
            ),
            field(
              'Категория',
              category
            )
          )
        ),
        h(
          'section',
          {
            class: 'newach3-card'
          },
          sectionHead(
            '02',
            'Вид достижения',
            'Дополнительные поля зависят от выбранного вида.'
          ),
          kindSeg,
          kindBox
        )
      ),
      h(
        'aside',
        {
          class: 'newach3-side'
        },
        h(
          'section',
          {
            class:
              'newach3-card newach3-doc-card'
          },
          sectionHead(
            '03',
            'Подтверждающий документ',
            'Документ используется сотрудником деканата при проверке.'
          ),
          doc.node,
          h(
            'div',
            {
              class: 'newach3-hint'
            },
            h(
              'span',
              {},
              'i'
            ),
            h(
              'p',
              {},
              'Файл не загружается в систему. Укажите ссылку или путь к скану документа.'
            )
          )
        )
      )
    ),
    err,
    h(
      'div',
      {
        class: 'newach3-actions'
      },
      h(
        'button',
        {
          type: 'button',
          class: 'btn ghost',
          onclick: m.close
        },
        'Отмена'
      ),
      h(
        'div',
        {
          class:
            'newach3-actions-main'
        },
        h(
          'button',
          {
            type: 'button',
            class: 'btn ghost',
            onclick:
              send(false)
          },
          'Сохранить черновик'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick:
              send(true)
          },
          'Отправить на проверку'
        )
      )
    )
  );
  title.focus();
};
})();
