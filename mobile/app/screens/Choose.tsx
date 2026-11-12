/** Several directory products match the NDC: the user chooses; nothing is picked for them. */
import React from 'react';
import type { ScreenModel } from '../../src/app/screens.ts';
import { FieldList } from '../ui/FieldList.tsx';
import { Button, H1, P, Section } from '../ui/kit.tsx';

type Choose = Extract<ScreenModel, { kind: 'CHOOSE_PRODUCT' }>;

export function Choose({ model, onChoose, onDone }: { model: Choose; onChoose: (i: number) => void; onDone: () => void }) {
  return (
    <>
      <H1>Choose your product</H1>
      <P>{model.text}</P>
      {model.options.map((o) => (
        <Section key={o.index} title={o.title || `Option ${o.index + 1}`}>
          <FieldList fields={o.fields} />
          <Button secondary title="This is my product" onPress={() => onChoose(o.index)} />
        </Section>
      ))}
      <Button secondary title="Start over" onPress={onDone} />
    </>
  );
}
