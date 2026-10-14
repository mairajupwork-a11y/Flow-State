import { Modal } from '../components/ui';

const GROUPS: [string, [string[], string][]][] = [
  ['Everywhere', [[['⌘/Ctrl', 'K'], 'Command palette & search'], [['/'], 'Search'], [['C'], 'Create a work item'], [['?'], 'Show these shortcuts'], [['Esc'], 'Close dialogs and panels']]],
  ['Go to', [[['G', 'H'], 'Overview'], [['G', 'B'], 'Board'], [['G', 'L'], 'Backlog'], [['G', 'I'], 'List'], [['G', 'R'], 'Reports'], [['G', 'T'], 'My tasks'], [['G', 'D'], 'My day'], [['G', 'M'], 'Team'], [['G', 'S'], 'Settings']]],
  ['On the board', [[['Space'], 'Pick up / drop a focused card'], [['← →'], 'Move a picked-up card between columns'], [['Enter'], 'Open the focused card']]],
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" subtitle="Move faster without leaving the keyboard" onClose={onClose}>
      <div className="modal-body shortcuts">
        {GROUPS.map(([title, rows]) => (
          <section key={title}>
            <h4>{title}</h4>
            {rows.map(([keysList, label]) => (
              <div className="shortcut-row" key={label}>
                <span>{label}</span>
                <span>{keysList.map((k) => <kbd className="kbd" key={k}>{k}</kbd>)}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
