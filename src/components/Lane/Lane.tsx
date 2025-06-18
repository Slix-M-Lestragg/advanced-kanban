import animateScrollTo from 'animated-scroll-to';
import classcat from 'classcat';
import update from 'immutability-helper';
import { Fragment, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/compat';
import {
  DraggableProps,
  Droppable,
  StaticDroppable,
  useNestedEntityPath,
} from 'src/dnd/components/Droppable';
import { ScrollContainer } from 'src/dnd/components/ScrollContainer';
import { SortPlaceholder } from 'src/dnd/components/SortPlaceholder';
import { Sortable, StaticSortable } from 'src/dnd/components/Sortable';
import { useDragHandle } from 'src/dnd/managers/DragManager';
import { frontmatterKey } from 'src/parsers/common';
import { getTaskStatusDone } from 'src/parsers/helpers/inlineMetadata';

import { Items } from '../Item/Item';
import { ItemForm } from '../Item/ItemForm';
import { KanbanContext, SearchContext, SortContext } from '../context';
import { c, generateInstanceId } from '../helpers';
import { DataTypes, EditState, EditingState, Item, Lane, getNestedLanes, getNestedItems, getLaneLevel, isParentLane } from '../types';
import { LaneHeader } from './LaneHeader';

const laneAccepts = [DataTypes.Item];

interface NestedContentProps {
  content: (Lane | Item)[];
  isStatic?: boolean;
  shouldMarkItemsComplete: boolean;
  collapseDir: 'horizontal' | 'vertical';
  currentLane: Lane; // Current lane that contains this content
}

function NestedContent({ content, isStatic, shouldMarkItemsComplete, collapseDir, currentLane }: NestedContentProps) {
  const { view } = useContext(KanbanContext);
  
  // Check if current lane is hierarchically collapsed (hiding its nested content)
  const isCurrentLaneCollapsed = useCallback(() => {
    if (!isParentLane(currentLane)) return false;
    const hierarchicalCollapseState = view.getViewState('hierarchical-collapse') || {};
    return hierarchicalCollapseState[currentLane.id] || false;
  }, [view, currentLane]);

  // Separate lanes and items for rendering
  const items = getNestedItems({ children: content } as Lane);
  const nestedLanes = getNestedLanes({ children: content } as Lane);

  return (
    <>
      {/* Always render items */}
      <Items
        items={items}
        isStatic={isStatic}
        shouldMarkItemsComplete={shouldMarkItemsComplete}
      />
      
      {/* Only render nested lanes if current lane is not collapsed */}
      {!isCurrentLaneCollapsed() && nestedLanes.length > 0 && (
        <div className={c('nested-lanes-container')}>
          <Lanes lanes={nestedLanes} collapseDir={collapseDir} />
        </div>
      )}
    </>
  );
}

export interface DraggableLaneProps {
  lane: Lane;
  laneIndex: number;
  isStatic?: boolean;
  collapseDir: 'horizontal' | 'vertical';
  isCollapsed?: boolean;
}

function DraggableLaneRaw({
  isStatic,
  lane,
  laneIndex,
  collapseDir,
  isCollapsed = false,
}: DraggableLaneProps) {
  const [editState, setEditState] = useState<EditState>(EditingState.cancel);
  const [isSorting, setIsSorting] = useState(false);

  const { stateManager, boardModifiers, view } = useContext(KanbanContext);
  const search = useContext(SearchContext);

  const boardView = view.useViewState(frontmatterKey);
  const path = useNestedEntityPath(laneIndex);
  const laneWidth = stateManager.useSetting('lane-width');
  const fullWidth = boardView === 'list' && stateManager.useSetting('full-list-lane-width');
  const insertionMethod = stateManager.useSetting('new-card-insertion-method');
  const laneStyles = useMemo(
    () =>
      !(isCollapsed && collapseDir === 'horizontal') && (fullWidth || laneWidth)
        ? { width: fullWidth ? '100%' : `${laneWidth}px` }
        : undefined,
    [fullWidth, laneWidth, isCollapsed]
  );

  const elementRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);

  const bindHandle = useDragHandle(measureRef, dragHandleRef);

  const shouldMarkItemsComplete = !!lane.data.shouldMarkItemsComplete;
  const isCompactPrepend = insertionMethod === 'prepend-compact';
  const shouldPrepend = isCompactPrepend || insertionMethod === 'prepend';

  // Hierarchical styling properties
  const laneLevel = getLaneLevel(lane);
  const isParent = isParentLane(lane);
  const hasNestedLanes = getNestedLanes(lane).length > 0;

  const toggleIsCollapsed = useCallback(() => {
    stateManager.setState((board) => {
      const collapseState = [...view.getViewState('list-collapse')];
      collapseState[laneIndex] = !collapseState[laneIndex];
      view.setViewState('list-collapse', collapseState);
      return update(board, {
        data: { settings: { 'list-collapse': { $set: collapseState } } },
      });
    });
  }, [stateManager, laneIndex]);

  // Enhanced hierarchical collapse functionality
  const toggleHierarchicalCollapse = useCallback(() => {
    if (!isParent) {
      // If not a parent lane, fall back to standard collapse
      toggleIsCollapsed();
      return;
    }

    stateManager.setState((board) => {
      // Get hierarchical collapse state (stored by lane ID)
      const hierarchicalCollapseState = view.getViewState('hierarchical-collapse') || {};
      const isCurrentlyCollapsed = hierarchicalCollapseState[lane.id] || false;
      
      // Toggle the collapse state for this specific lane
      const newHierarchicalState = {
        ...hierarchicalCollapseState,
        [lane.id]: !isCurrentlyCollapsed
      };
      
      view.setViewState('hierarchical-collapse', newHierarchicalState);
      
      return update(board, {
        data: { 
          settings: { 
            'hierarchical-collapse': { $set: newHierarchicalState }
          } 
        },
      });
    });
  }, [stateManager, lane.id, isParent, toggleIsCollapsed]);

  // Determine if this lane should be collapsed (hierarchical or standard)
  const isHierarchicallyCollapsed = useCallback(() => {
    if (!isParent) return false;
    const hierarchicalCollapseState = view.getViewState('hierarchical-collapse') || {};
    return hierarchicalCollapseState[lane.id] || false;
  }, [view, lane.id, isParent]);

  // Keyboard navigation for collapse/expand
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isParent) return;
    
    // Arrow Left/Right for collapse/expand
    if (e.key === 'ArrowLeft' && !isHierarchicallyCollapsed()) {
      e.preventDefault();
      e.stopPropagation();
      toggleHierarchicalCollapse();
    } else if (e.key === 'ArrowRight' && isHierarchicallyCollapsed()) {
      e.preventDefault();
      e.stopPropagation();
      toggleHierarchicalCollapse();
    }
    // Space/Enter to toggle
    else if ((e.key === ' ' || e.key === 'Enter') && e.target === elementRef.current) {
      e.preventDefault();
      e.stopPropagation();
      toggleHierarchicalCollapse();
    }
  }, [isParent, isHierarchicallyCollapsed, toggleHierarchicalCollapse]);

  // Add keyboard event listeners and accessibility attributes
  useEffect(() => {
    const element = elementRef.current;
    if (element && isParent) {
      element.addEventListener('keydown', handleKeyDown);
      element.setAttribute('tabindex', '0'); // Make focusable
      element.setAttribute('role', 'button');
      element.setAttribute('aria-expanded', (!isHierarchicallyCollapsed()).toString());
      element.setAttribute('aria-label', `${lane.data.title} - ${isHierarchicallyCollapsed() ? 'Expand' : 'Collapse'} nested lanes`);
      
      return () => {
        element.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [handleKeyDown, isParent, isHierarchicallyCollapsed, lane.data.title]);

  // Apply aria-expanded to the lane wrapper for CSS styling
  const laneWrapperProps = useMemo(() => {
    const props: any = {
      ref: measureRef,
      className: classcat([
        c('lane-wrapper'),
        c(`lane-wrapper--level-${laneLevel}`),
        {
          'is-sorting': isSorting,
          'collapse-horizontal': isCollapsed && collapseDir === 'horizontal',
          'collapse-vertical': isCollapsed && collapseDir === 'vertical',
          [c('lane-wrapper--parent')]: isParent,
          [c('lane-wrapper--has-nested')]: hasNestedLanes,
        },
      ]),
      style: {
        ...laneStyles,
        '--lane-level': laneLevel,
      } as React.CSSProperties,
    };

    // Add aria-expanded for hierarchical collapse styling
    if (isParent) {
      props['aria-expanded'] = !isHierarchicallyCollapsed();
    }

    return props;
  }, [measureRef, laneLevel, isSorting, isCollapsed, collapseDir, isParent, hasNestedLanes, laneStyles, isHierarchicallyCollapsed]);

  const addItems = useCallback(
    (items: Item[]) => {
      boardModifiers[shouldPrepend ? 'prependItems' : 'appendItems'](
        [...path, lane.children.length - 1],
        items.map((item) =>
          update(item, {
            data: {
              checked: {
                // Mark the item complete if we're moving into a completed lane
                $set: shouldMarkItemsComplete,
              },
              checkChar: {
                $set: shouldMarkItemsComplete ? getTaskStatusDone() : ' ',
              },
            },
          })
        )
      );

      // TODO: can we find a less brute force way to do this?
      view.getWindow().setTimeout(() => {
        const laneItems = elementRef.current?.getElementsByClassName(c('lane-items'));

        if (laneItems.length) {
          animateScrollTo([0, shouldPrepend ? 0 : laneItems[0].scrollHeight], {
            elementToScroll: laneItems[0],
            speed: 200,
            minDuration: 150,
            easing: (x: number) => {
              return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
            },
          });
        }
      });
    },
    [boardModifiers, path, lane, shouldPrepend]
  );

  const DroppableComponent = isStatic ? StaticDroppable : Droppable;
  const SortableComponent = isStatic ? StaticSortable : Sortable;
  const CollapsedDropArea = !isCollapsed || isStatic ? Fragment : Droppable;
  const dropAreaProps: DraggableProps = useMemo(() => {
    if (!isCollapsed || isStatic) return {} as any;
    const data = {
      id: generateInstanceId(),
      type: 'lane',
      accepts: [DataTypes.Item],
      acceptsSort: [DataTypes.Lane],
    };
    return {
      elementRef: elementRef,
      measureRef: measureRef,
      id: data.id,
      index: laneIndex,
      data: data,
    };
  }, [isCollapsed, laneIndex, isStatic]);

  return (
    <SortContext.Provider value={lane.data.sorted ?? null}>
      <div {...laneWrapperProps}>
        <div
          data-count={lane.children.length}
          ref={elementRef}
          className={classcat([
            c('lane'), 
            c(`lane--level-${laneLevel}`),
            { 
              'will-prepend': shouldPrepend,
              [c('lane--parent')]: isParent,
              [c('lane--has-nested')]: hasNestedLanes,
            }
          ])}
        >
          <CollapsedDropArea {...dropAreaProps}>
            <LaneHeader
              bindHandle={bindHandle}
              laneIndex={laneIndex}
              lane={lane}
              setIsItemInputVisible={isCompactPrepend ? setEditState : undefined}
              isCollapsed={isCollapsed}
              toggleIsCollapsed={isParent ? toggleHierarchicalCollapse : toggleIsCollapsed}
            />

            {!search?.query && !isCollapsed && shouldPrepend && (
              <ItemForm
                addItems={addItems}
                hideButton={isCompactPrepend}
                editState={editState}
                setEditState={setEditState}
              />
            )}

            {!isCollapsed && (
              <DroppableComponent
                elementRef={elementRef}
                measureRef={measureRef}
                id={lane.id}
                index={laneIndex}
                data={lane}
              >
                <ScrollContainer
                  className={classcat([c('lane-items'), c('vertical')])}
                  id={lane.id}
                  index={laneIndex}
                  isStatic={isStatic}
                  triggerTypes={laneAccepts}
                >
                  <SortableComponent onSortChange={setIsSorting} axis="vertical">
                    <NestedContent
                      content={lane.children}
                      isStatic={isStatic}
                      shouldMarkItemsComplete={shouldMarkItemsComplete}
                      collapseDir={collapseDir}
                      currentLane={lane}
                    />
                    <SortPlaceholder
                      accepts={laneAccepts}
                      index={lane.children.length}
                      isStatic={isStatic}
                    />
                  </SortableComponent>
                </ScrollContainer>
              </DroppableComponent>
            )}

            {!search?.query && !isCollapsed && !shouldPrepend && (
              <ItemForm addItems={addItems} editState={editState} setEditState={setEditState} />
            )}
          </CollapsedDropArea>
        </div>
      </div>
    </SortContext.Provider>
  );
}

export const DraggableLane = memo(DraggableLaneRaw);

export interface LanesProps {
  lanes: Lane[];
  collapseDir: 'horizontal' | 'vertical';
}

function LanesRaw({ lanes, collapseDir }: LanesProps) {
  const search = useContext(SearchContext);
  const { view } = useContext(KanbanContext);
  const boardView = view.useViewState(frontmatterKey) || 'board';
  const collapseState = view.useViewState('list-collapse') || [];

  return (
    <>
      {lanes.map((lane, i) => {
        return (
          <DraggableLane
            collapseDir={collapseDir}
            isCollapsed={(search?.query && !search.lanes.has(lane)) || !!collapseState[i]}
            key={boardView + lane.id}
            lane={lane}
            laneIndex={i}
          />
        );
      })}
    </>
  );
}

export const Lanes = memo(LanesRaw);
