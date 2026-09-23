import { ArrowClockwise, Warning } from '@phosphor-icons/react';
import { Component, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/Layout';

/**
 * One page failing must not take the app down with it. This catches render and
 * lazy-import errors under the router, keeps the top bar alive, and offers the
 * two things that actually help: try again, or go home.
 */
export class RouteBoundary extends Component<{ children: ReactNode; routeKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(previous: { children: ReactNode; routeKey: string }) {
    // Navigating away clears the error, so a broken page doesn't stick.
    if (previous.routeKey !== this.props.routeKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error: Error) {
    console.error('Page failed to render', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <EmptyState
        icon={<Warning size={22} weight="duotone" />}
        title="This page didn’t load"
        actions={
          <>
            <Button variant="primary" leading={<ArrowClockwise size={15} />} onClick={() => location.reload()}>
              Try again
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                location.hash = '#/home';
                this.setState({ error: null });
              }}
            >
              Go home
            </Button>
          </>
        }
      >
        The rest of the app is still working. {this.state.error.message.slice(0, 160)}
      </EmptyState>
    );
  }
}
