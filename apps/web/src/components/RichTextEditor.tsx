import { RichTextEditor as Mantine, Link } from '@mantine/tiptap';
import '@mantine/tiptap/styles.css';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';

interface Props {
  value: string;
  onChange: (html: string) => void;
  label: string;
  minHeight?: number;
}

/** Rich text with bold/italic/lists/quotes/code blocks/links (spec 6.2). Output is sanitised by the API. */
export function RichTextEditor({ value, onChange, label, minHeight = 100 }: Props) {
  // Keep the latest callback without recreating the editor on every render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editor = useEditor(
    {
      extensions: [StarterKit, Link.configure({ openOnClick: false })],
      content: value,
      shouldRerenderOnTransaction: false,
      onUpdate: ({ editor: e }) => onChangeRef.current(e.isEmpty ? '' : e.getHTML()),
      editorProps: { attributes: { 'aria-label': label, role: 'textbox', 'aria-multiline': 'true' } },
    },
    [],
  );
  // Reset when the parent clears the value (e.g. after sending).
  useEffect(() => {
    if (editor && value === '' && !editor.isEmpty) editor.commands.clearContent();
  }, [editor, value]);
  return (
    <Mantine editor={editor}>
      <Mantine.Toolbar>
        <Mantine.ControlsGroup>
          <Mantine.Bold />
          <Mantine.Italic />
          <Mantine.Strikethrough />
          <Mantine.Code />
        </Mantine.ControlsGroup>
        <Mantine.ControlsGroup>
          <Mantine.BulletList />
          <Mantine.OrderedList />
          <Mantine.Blockquote />
          <Mantine.CodeBlock />
        </Mantine.ControlsGroup>
        <Mantine.ControlsGroup>
          <Mantine.Link />
          <Mantine.Unlink />
        </Mantine.ControlsGroup>
      </Mantine.Toolbar>
      <Mantine.Content style={{ minHeight }} />
    </Mantine>
  );
}
