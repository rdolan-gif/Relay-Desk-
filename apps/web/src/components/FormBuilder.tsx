import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import type { ReactNode } from 'react';
import {
  sortedOptions,
  type CustomFieldDef,
  type FieldPlacement,
  type FormLayout,
  type FormSection,
} from '@relay-desk/domain';
import { t } from '../i18n/en-GB';

interface Props {
  layout: FormLayout;
  fields: CustomFieldDef[];
  onChange: (layout: FormLayout) => void;
}

function Handle({ label, listeners, attributes }: { label: string; listeners?: object; attributes?: object }) {
  return (
    <ActionIcon variant="subtle" aria-label={label} style={{ cursor: 'grab' }} {...attributes} {...listeners}>
      ⠿
    </ActionIcon>
  );
}

function Sortable({ id, label, children }: { id: string; label: string; children: (h: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      {children(<Handle label={t.builder.dragHandle(label)} listeners={listeners} attributes={attributes} />)}
    </div>
  );
}

/**
 * Drag-and-drop form layout editor (spec 7.4), shared by contact, account and record
 * forms (and ticket categories later). Sections and fields reorder by dragging or with
 * the keyboard (focus the handle, Space, arrow keys, Space). Fields move between
 * sections with "Move to section".
 */
export function FormBuilder({ layout, fields, onChange }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byId = new Map(fields.map((f) => [f.id, f]));
  const placed = new Set(layout.sections.flatMap((s) => s.fields.map((f) => f.fieldId)));
  const allPlaced = layout.sections.flatMap((s) => s.fields);

  const setSections = (sections: FormSection[]) => onChange({ sections });
  const updateSection = (id: string, patch: Partial<FormSection>) =>
    setSections(layout.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const updatePlacement = (sectionId: string, fieldId: string, patch: Partial<FieldPlacement>) =>
    updateSection(sectionId, {
      fields: layout.sections
        .find((s) => s.id === sectionId)!
        .fields.map((f) => (f.fieldId === fieldId ? { ...f, ...patch } : f)),
    });

  const onSectionDrag = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = layout.sections.map((s) => s.id);
    setSections(arrayMove(layout.sections, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))));
  };
  const onFieldDrag = (sectionId: string) => (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const section = layout.sections.find((s) => s.id === sectionId)!;
    const ids = section.fields.map((f) => f.fieldId);
    updateSection(sectionId, {
      fields: arrayMove(section.fields, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))),
    });
  };
  const moveField = (fromId: string, toId: string, fieldId: string) => {
    const from = layout.sections.find((s) => s.id === fromId)!;
    const placement = from.fields.find((f) => f.fieldId === fieldId)!;
    setSections(
      layout.sections.map((s) =>
        s.id === fromId
          ? { ...s, fields: s.fields.filter((f) => f.fieldId !== fieldId) }
          : s.id === toId
            ? { ...s, fields: [...s.fields, placement] }
            : s,
      ),
    );
  };
  const removeField = (sectionId: string, fieldId: string) => {
    // Also drop visibility rules that pointed at the removed field.
    setSections(
      layout.sections.map((s) => ({
        ...s,
        fields: s.fields
          .filter((f) => !(s.id === sectionId && f.fieldId === fieldId))
          .map((f) => (f.visibleWhen?.fieldId === fieldId ? { ...f, visibleWhen: undefined } : f)),
      })),
    );
  };

  return (
    <Stack>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSectionDrag}>
        <SortableContext items={layout.sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {layout.sections.map((section) => (
            <Sortable key={section.id} id={section.id} label={section.title || 'section'}>
              {(handle) => (
                <Paper withBorder p="sm">
                  <Stack gap="xs">
                    <Group align="flex-end" wrap="nowrap">
                      {handle}
                      <TextInput
                        label={t.builder.sectionTitle}
                        value={section.title}
                        onChange={(e) => updateSection(section.id, { title: e.currentTarget.value })}
                        style={{ flex: 1 }}
                      />
                      <Checkbox
                        label={t.builder.collapsed}
                        checked={!!section.collapsed}
                        onChange={(e) => updateSection(section.id, { collapsed: e.currentTarget.checked })}
                      />
                      <Button
                        size="xs"
                        color="red"
                        variant="subtle"
                        onClick={() => setSections(layout.sections.filter((s) => s.id !== section.id))}
                      >
                        {t.builder.removeSection}
                      </Button>
                    </Group>
                    <Textarea
                      label={t.builder.sectionDescription}
                      autosize
                      minRows={1}
                      value={section.description ?? ''}
                      onChange={(e) => updateSection(section.id, { description: e.currentTarget.value || undefined })}
                    />
                    {section.fields.length === 0 && (
                      <Text size="sm" c="dimmed">
                        {t.builder.empty}
                      </Text>
                    )}
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={onFieldDrag(section.id)}
                    >
                      <SortableContext
                        items={section.fields.map((f) => f.fieldId)}
                        strategy={verticalListSortingStrategy}
                      >
                        {section.fields.map((p) => {
                          const def = byId.get(p.fieldId);
                          const controllers = allPlaced.filter((o) => o.fieldId !== p.fieldId && byId.has(o.fieldId));
                          const controller = p.visibleWhen ? byId.get(p.visibleWhen.fieldId) : undefined;
                          return (
                            <Sortable key={p.fieldId} id={p.fieldId} label={def?.name ?? 'field'}>
                              {(h) => (
                                <Paper withBorder p="xs" bg="var(--mantine-color-default-hover)">
                                  <Stack gap={6}>
                                    <Group justify="space-between" wrap="nowrap">
                                      <Group gap="xs">
                                        {h}
                                        <Text fw={500}>{def?.name ?? p.fieldId}</Text>
                                        <Text size="xs" c="dimmed">
                                          {def ? t.fields.types[def.type] : ''}
                                        </Text>
                                      </Group>
                                      <Group gap="xs">
                                        {layout.sections.length > 1 && (
                                          <Select
                                            aria-label={t.builder.moveTo}
                                            placeholder={t.builder.moveTo}
                                            size="xs"
                                            w={160}
                                            data={layout.sections
                                              .filter((s) => s.id !== section.id)
                                              .map((s) => ({ value: s.id, label: s.title || s.id }))}
                                            value={null}
                                            onChange={(to) => to && moveField(section.id, to, p.fieldId)}
                                          />
                                        )}
                                        <Button
                                          size="compact-xs"
                                          color="red"
                                          variant="subtle"
                                          onClick={() => removeField(section.id, p.fieldId)}
                                        >
                                          {t.builder.remove}
                                        </Button>
                                      </Group>
                                    </Group>
                                    <Group gap="md" wrap="wrap">
                                      <Checkbox
                                        size="xs"
                                        label={t.builder.required}
                                        checked={!!p.required}
                                        onChange={(e) =>
                                          updatePlacement(section.id, p.fieldId, { required: e.currentTarget.checked })
                                        }
                                      />
                                      <Checkbox
                                        size="xs"
                                        label={t.builder.readOnly}
                                        checked={!!p.readOnly}
                                        onChange={(e) =>
                                          updatePlacement(section.id, p.fieldId, { readOnly: e.currentTarget.checked })
                                        }
                                      />
                                      <Checkbox
                                        size="xs"
                                        label={t.builder.hidden}
                                        checked={!!p.hidden}
                                        onChange={(e) =>
                                          updatePlacement(section.id, p.fieldId, { hidden: e.currentTarget.checked })
                                        }
                                      />
                                      {def?.type === 'textarea' && (
                                        <NumberInput
                                          size="xs"
                                          w={90}
                                          label={t.builder.rows}
                                          min={1}
                                          max={50}
                                          value={p.rows ?? 3}
                                          onChange={(v) =>
                                            updatePlacement(section.id, p.fieldId, { rows: Number(v) || undefined })
                                          }
                                        />
                                      )}
                                    </Group>
                                    <TextInput
                                      size="xs"
                                      label={t.builder.tooltip}
                                      value={p.tooltip ?? ''}
                                      onChange={(e) =>
                                        updatePlacement(section.id, p.fieldId, {
                                          tooltip: e.currentTarget.value || undefined,
                                        })
                                      }
                                    />
                                    <Group gap="xs" align="flex-end">
                                      <Select
                                        size="xs"
                                        w={220}
                                        label={t.builder.showWhen}
                                        data={[
                                          { value: '', label: t.builder.always },
                                          ...controllers.map((c) => ({
                                            value: c.fieldId,
                                            label: byId.get(c.fieldId)!.name,
                                          })),
                                        ]}
                                        value={p.visibleWhen?.fieldId ?? ''}
                                        allowDeselect={false}
                                        onChange={(v) =>
                                          updatePlacement(section.id, p.fieldId, {
                                            visibleWhen: v ? { fieldId: v, equals: '' } : undefined,
                                          })
                                        }
                                      />
                                      {p.visibleWhen && controller && (
                                        <VisibilityValue
                                          def={controller}
                                          value={p.visibleWhen.equals}
                                          onChange={(equals) =>
                                            updatePlacement(section.id, p.fieldId, {
                                              visibleWhen: { fieldId: p.visibleWhen!.fieldId, equals },
                                            })
                                          }
                                        />
                                      )}
                                    </Group>
                                  </Stack>
                                </Paper>
                              )}
                            </Sortable>
                          );
                        })}
                      </SortableContext>
                    </DndContext>
                    <Select
                      size="xs"
                      w={260}
                      placeholder={t.builder.addField}
                      aria-label={t.builder.addField}
                      data={fields
                        .filter((f) => !placed.has(f.id))
                        .map((f) => ({ value: f.id, label: `${f.name} (${t.fields.types[f.type]})` }))}
                      value={null}
                      searchable
                      onChange={(fieldId) =>
                        fieldId && updateSection(section.id, { fields: [...section.fields, { fieldId }] })
                      }
                    />
                  </Stack>
                </Paper>
              )}
            </Sortable>
          ))}
        </SortableContext>
      </DndContext>
      <Group>
        <Button
          variant="light"
          size="xs"
          onClick={() =>
            setSections([...layout.sections, { id: `s${Date.now().toString(36)}`, title: 'New section', fields: [] }])
          }
        >
          {t.builder.addSection}
        </Button>
      </Group>
    </Stack>
  );
}

function VisibilityValue({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDef;
  value: string | number | boolean;
  onChange: (v: string | number | boolean) => void;
}) {
  if (def.options.length) {
    return (
      <Select
        size="xs"
        w={180}
        label={t.builder.equals}
        data={sortedOptions(def.options).map((o) => ({ value: o.value, label: o.label }))}
        value={value === '' ? null : String(value)}
        onChange={(v) => onChange(v ?? '')}
      />
    );
  }
  if (def.type === 'checkbox') {
    return (
      <Select
        size="xs"
        w={120}
        label={t.builder.equals}
        data={[
          { value: 'true', label: 'Ticked' },
          { value: 'false', label: 'Not ticked' },
        ]}
        value={String(value === true)}
        onChange={(v) => onChange(v === 'true')}
      />
    );
  }
  return (
    <TextInput
      size="xs"
      w={180}
      label={t.builder.equals}
      value={String(value)}
      onChange={(e) => onChange(def.type === 'number' ? Number(e.currentTarget.value) : e.currentTarget.value)}
    />
  );
}
