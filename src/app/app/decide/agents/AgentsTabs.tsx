'use client';

import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function AgentsTabs({
  stacks,
  plans,
  defaultTab = 'stacks',
}: {
  stacks: ReactNode;
  plans: ReactNode;
  defaultTab?: 'stacks' | 'plans';
}) {
  return (
    <Tabs defaultValue={defaultTab} className="mt-1">
      <TabsList>
        <TabsTrigger value="stacks">Stacks</TabsTrigger>
        <TabsTrigger value="plans">Plans</TabsTrigger>
      </TabsList>
      <TabsContent value="stacks" className="mt-5">
        {stacks}
      </TabsContent>
      <TabsContent value="plans" className="mt-5">
        {plans}
      </TabsContent>
    </Tabs>
  );
}
