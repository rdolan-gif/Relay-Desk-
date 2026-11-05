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
import { ActionIcon, Box, Button, Group, Modal, NavLink, Stack, Text } from '@mantine/core';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { t } from '../i18n/en-GB';
import type { Sidebar } from '../tickets/types';

type Item = Sidebar['items'][number];
interface ViewInfo {
  id: string;
  name: string;
}

const REVEAL = 56; // px the row slides to show the bin
const THRESHOLD = 32; // px of swipe needed to keep it open

const Bin = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </svg>
);

/** One view: a drag handle to reorder, and a row that swipes left to reveal a bin. */
function Row(props: {
  item: Item;
  view: ViewInfo;
  active: boolean;
  revealed: boolean;
  onReveal: (open: boolean) => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.viewId,
  });
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; base: number } | null>(null);
  const moved = useRef(false);
  const offset = props.revealed ? -REVEAL : 0;

  const down = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, base: offset };
    moved.current = false;
  };
  const move = (e: ReactPointerEvent) => {
    const s = start.current;
    if (!s) return;
    const x = e.clientX - s.x;
    if (!moved.current && Math.abs(x) < 6) return;
    if (!moved.current && Math.abs(e.clientY - s.y) > Math.abs(x)) {
      start.current = null; // a vertical gesture: let the page scroll
      return;
    }
    moved.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDx(Math.max(-REVEAL - 16, Math.min(0, s.base + x)) - offset);
  };
  const up = () => {
    if (!start.current) return;
    start.current = null;
    if (moved.current) props.onReveal(offset + dx < -THRESHOLD);
    setDx(0);
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        position: 'relative',
        zIndex: isDragging ? 2 : undefined,
      }}
    >
      <Box
        pos="relative"
        style={{ overflow: 'hidden', borderRadius: 'var(--mantine-radius-sm)' }}
        pl={props.item.parentViewId ? 'md' : 0}
      >
        <Group
          pos="absolute"
          top={0}
          right={0}
          bottom={0}
          w={REVEAL}
          justify="center"
          style={{
            background: 'var(--mantine-color-red-filled)',
            visibility: props.revealed || dx !== 0 ? 'visible' : 'hidden', // no red edge peeking out at rest
          }}
          aria-hidden={!props.revealed}
        >
          <ActionIcon
            variant="transparent"
            c="white"
            aria-label={`${t.tickets.deleteView}: ${props.view.name}`}
            tabIndex={props.revealed ? 0 : -1}
            onClick={props.onDelete}
          >
            <Bin />
          </ActionIcon>
        </Group>
        <Group
          gap={0}
          wrap="nowrap"
          style={{
            transform: `translateX(${offset + dx}px)`,
            transition: start.current ? 'none' : 'transform 150ms ease',
            background: 'var(--mantine-color-body)',
            touchAction: 'pan-y',
          }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={`${t.tickets.dragView}: ${props.view.name}`}
            style={{ cursor: 'grab', touchAction: 'none' }}
            {...attributes}
            {...listeners}
            onPointerDown={(e) => {
              e.stopPropagation(); // the handle drags; it never starts a swipe
              listeners?.onPointerDown?.(e);
            }}
          >
            ⠿
          </ActionIcon>
          <NavLink
            label={props.view.name}
            description={props.item.folder ?? undefined}
            active={props.active}
            style={{ flex: 1 }}
            onClick={(e) => {
              if (moved.current) {
                e.preventDefault();
                moved.current = false;
                return;
              }
              if (props.revealed) props.onReveal(false);
              else props.onOpen();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                props.onDelete();
              }
            }}
          />
        </Group>
      </Box>
    </div>
  );
}

/**
 * My views (owner request): drag the handle to reorder, then confirm "Save changes";
 * swipe a view left to reveal a bin, then confirm the deletion. Keyboard: the handle moves
 * with Space and the arrow keys; Delete on a view asks to delete it.
 */
export function MyViewsList(props: {
  items: Item[];
  views: Map<string, ViewInfo>;
  ownViewIds: Set<string>;
  activeId: string | null;
  saving: boolean;
  onOpen: (viewId: string) => void;
  onSaveOrder: (items: Item[]) => Promise<unknown>;
  onDelete: (item: Item) => Promise<unknown>;
}) {
  const [order, setOrder] = useState(props.items);
  const [pendingOrder, setPendingOrder] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const key = props.items.map((i) => i.viewId).join(',');
  useEffect(() => {
    if (!pendingOrder) setOrder(props.items);
  }, [key]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = order.findIndex((i) => i.viewId === e.active.id);
    const to = order.findIndex((i) => i.viewId === e.over!.id);
    setOrder(arrayMove(order, from, to));
    setRevealed(null);
    setPendingOrder(true);
  };
  const deletingView = deleting ? props.views.get(deleting.viewId) : undefined;
  const own = deleting ? props.ownViewIds.has(deleting.viewId) : false;

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order.map((i) => i.viewId)} strategy={verticalListSortingStrategy}>
          <Stack gap={2}>
            {order.map((i) => {
              const v = props.views.get(i.viewId);
              if (!v) return null;
              return (
                <Row
                  key={i.viewId}
                  item={i}
                  view={v}
                  active={props.activeId === v.id}
                  revealed={revealed === i.viewId}
                  onReveal={(open) => setRevealed(open ? i.viewId : null)}
                  onOpen={() => props.onOpen(v.id)}
                  onDelete={() => setDeleting(i)}
                />
              );
            })}
          </Stack>
        </SortableContext>
      </DndContext>
      {order.length > 1 && (
        <Text size="xs" c="dimmed">
          {t.tickets.viewsHelp}
        </Text>
      )}

      <Modal
        opened={pendingOrder}
        onClose={() => (setPendingOrder(false), setOrder(props.items))}
        title={t.tickets.saveOrderTitle}
        size="sm"
      >
        <Stack>
          <Text size="sm">{t.tickets.saveOrderText}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => (setPendingOrder(false), setOrder(props.items))}>
              {t.tickets.discard}
            </Button>
            <Button
              loading={props.saving}
              onClick={async () => {
                await props.onSaveOrder(order.map((i, position) => ({ ...i, position })));
                setPendingOrder(false);
              }}
            >
              {t.tickets.saveChanges}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={!!deleting}
        onClose={() => setDeleting(null)}
        title={own ? t.tickets.deleteViewTitle : t.tickets.removeViewTitle}
        size="sm"
      >
        <Stack>
          <Text size="sm">
            {own
              ? t.tickets.deleteViewText(deletingView?.name ?? '')
              : t.tickets.removeViewText(deletingView?.name ?? '')}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)}>
              {t.common.cancel}
            </Button>
            <Button
              color="red"
              loading={busy}
              data-autofocus
              onClick={async () => {
                setBusy(true);
                try {
                  await props.onDelete(deleting!);
                  setRevealed(null);
                  setDeleting(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {own ? t.tickets.deleteViewConfirm : t.tickets.removeViewConfirm}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
