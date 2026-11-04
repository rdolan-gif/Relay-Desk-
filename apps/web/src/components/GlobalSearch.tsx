import { Combobox, Group, Text, TextInput, useCombobox } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { t } from '../i18n/en-GB';

interface Results {
  tickets: { id: number; title: string }[];
  contacts: { id: string; name: string; emails: string[] }[];
  accounts: { id: string; name: string }[];
  records: { id: string; title: string }[];
  kb?: { id: string; title: string }[];
}

/**
 * Top-bar search (spec 14): typeahead after 300 ms, minimum 3 characters, results
 * grouped by type. The API applies the user's access and rights to each group.
 */
export function GlobalSearch() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [debounced] = useDebouncedValue(q, 300);
  const combobox = useCombobox();
  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api<Results>('GET', `/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.trim().length >= 3,
  });
  const groups = [
    {
      label: t.crm.contacts,
      items: (results.data?.contacts ?? []).map((c) => ({
        value: `/crm/contacts/${c.id}`,
        label: c.name,
        hint: c.emails[0],
      })),
    },
    {
      label: t.crm.accounts,
      items: (results.data?.accounts ?? []).map((a) => ({
        value: `/crm/accounts/${a.id}`,
        label: a.name,
        hint: undefined,
      })),
    },
    {
      label: t.crm.records,
      items: (results.data?.records ?? []).map((r) => ({
        value: `/crm/records/${r.id}`,
        label: r.title,
        hint: undefined,
      })),
    },
    {
      label: t.kb.title,
      items: (results.data?.kb ?? []).map((a) => ({ value: `/kb/articles/${a.id}`, label: a.title, hint: undefined })),
    },
  ].filter((g) => g.items.length);

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(value) => {
        nav(value);
        setQ('');
        combobox.closeDropdown();
      }}
    >
      <Combobox.Target>
        <TextInput
          aria-label={t.search.placeholder}
          placeholder={t.search.placeholder}
          value={q}
          w={{ base: 160, sm: 320 }}
          onChange={(e) => {
            setQ(e.currentTarget.value);
            combobox.openDropdown();
          }}
          onFocus={() => combobox.openDropdown()}
          onBlur={() => combobox.closeDropdown()}
        />
      </Combobox.Target>
      <Combobox.Dropdown hidden={q.trim().length === 0}>
        <Combobox.Options>
          {q.trim().length < 3 ? (
            <Combobox.Empty>{t.search.minChars}</Combobox.Empty>
          ) : groups.length === 0 ? (
            <Combobox.Empty>{results.isFetching ? t.common.loading : t.crm.noResults}</Combobox.Empty>
          ) : (
            groups.map((g) => (
              <Combobox.Group key={g.label} label={g.label}>
                {g.items.map((i) => (
                  <Combobox.Option key={i.value} value={i.value}>
                    <Group gap="xs">
                      <Text size="sm">{i.label}</Text>
                      {i.hint && (
                        <Text size="xs" c="dimmed">
                          {i.hint}
                        </Text>
                      )}
                    </Group>
                  </Combobox.Option>
                ))}
              </Combobox.Group>
            ))
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
