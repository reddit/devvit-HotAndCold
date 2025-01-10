import { ComponentProps } from 'react';
import { Modal } from '@hotandcold/webview-common/components/modal';

export const HowToPlayModal = (props: Omit<ComponentProps<typeof Modal>, 'children'>) => {
  return (
    <Modal {...props}>
      <div className="p-6">
        <h3 className="mb-4 text-xl font-bold text-white">How to Play</h3>
        <p className="mb-4 text-gray-300">
          Guess the secret word by entering words with similar meanings. Words are scored based on
          how semantically related they are to the target word.
        </p>
        <div className="space-y-4">
          <p className="text-gray-300">Example: If the secret word is "ocean":</p>
          <ul className="space-y-2">
            <li className="flex items-center space-x-2">
              <span className="rounded bg-[#FE5555] px-2 py-1 text-white">sea</span>
              <span className="text-gray-300">would score 80-100 (highly related)</span>
            </li>
            <li className="flex items-center space-x-2">
              <span className="rounded bg-[#FED155] px-2 py-1 text-black">wave</span>
              <span className="text-gray-300">would score 40-79 (somewhat related)</span>
            </li>
            <li className="flex items-center space-x-2">
              <span className="rounded bg-[#4DE1F2] px-2 py-1 text-black">calculator</span>
              <span className="text-gray-300">would score 0-39 (distantly/unrelated)</span>
            </li>
          </ul>
        </div>
        <p className="mt-4 italic text-gray-300">
          Think about synonyms, categories, and related concepts to find the secret word.
        </p>
      </div>
    </Modal>
  );
};
