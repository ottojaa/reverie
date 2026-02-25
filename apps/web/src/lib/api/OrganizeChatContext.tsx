import { createContext, useContext, useState, type ReactNode } from 'react';
import { useOrganizeChat } from './organize';

type OrganizeChatContextValue = ReturnType<typeof useOrganizeChat> & {
    input: string;
    setInput: (value: string) => void;
};

const OrganizeChatContext = createContext<OrganizeChatContextValue | null>(null);

export function OrganizeChatProvider({ children }: { children: ReactNode }) {
    const chatState = useOrganizeChat();
    const [input, setInput] = useState('');

    return (
        <OrganizeChatContext.Provider value={{ ...chatState, input, setInput }}>
            {children}
        </OrganizeChatContext.Provider>
    );
}

export function useOrganizeChatContext(): OrganizeChatContextValue {
    const context = useContext(OrganizeChatContext);

    if (!context) {
        throw new Error('useOrganizeChatContext must be used within OrganizeChatProvider');
    }

    return context;
}
