import React from "react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { CommandPalette } from "../../../src/components/commandPalette/CommandPalette";
import { clearPaletteRecents, readPaletteRecents } from "../../../src/lib/commandPalette/persistedRecents";
import { scope, assets } from "./fixtures";
const state=vi.hoisted(()=>({push:vi.fn(),pathname:"/dashboard",session:{isConnected:true,address:"0xabc",family:"evm",chainId:1,stellar:{network:"stellar-testnet"}}}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:state.push}),usePathname:()=>state.pathname}));
vi.mock("@/providers/WalletSessionProvider",()=>({useWalletSessionContext:()=>state.session}));
vi.mock("next/dynamic",async()=>{
  const {CommandPalette: Palette}=await import("../../../src/components/commandPalette/CommandPalette");
  return {default:()=>Palette};
});
import { CommandTrigger } from "../../../src/components/commandPalette/CommandTrigger";
beforeEach(()=>{
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
  state.session={isConnected:true,address:"0xabc",family:"evm",chainId:1,stellar:{network:"stellar-testnet"}};
});
afterEach(()=>{cleanup();window.localStorage.clear();});
it("supports keyboard selection, focus trapping, escape and focus restoration",()=>{
  const opener=document.createElement("button");document.body.append(opener);opener.focus();
  const close=vi.fn(),navigate=vi.fn();
  const view=render(<CommandPalette open scope={scope} assets={assets} close={close} navigate={navigate}/>);
  const search=screen.getByRole("combobox");expect(document.activeElement).toBe(search);
  fireEvent.change(search,{target:{value:"scan"}});fireEvent.keyDown(search,{key:"Enter"});
  expect(navigate).toHaveBeenCalledWith("/scan");expect(close).toHaveBeenCalled();
  fireEvent.keyDown(search,{key:"Tab",shiftKey:true});expect(document.activeElement).toBe(screen.getByRole("button",{name:"Close search"}));
  fireEvent.keyDown(document.activeElement!,{key:"Tab"});expect(document.activeElement).toBe(search);
  fireEvent.keyDown(search,{key:"Escape"});expect(close).toHaveBeenCalledTimes(2);
  view.unmount();expect(document.activeElement).toBe(opener);opener.remove();
});
it("keeps IME Enter inert and announces an empty result without an active descendant",()=>{
  const navigate=vi.fn();render(<CommandPalette open scope={scope} assets={assets} close={()=>{}} navigate={navigate}/>);
  const search=screen.getByRole("combobox");
  fireEvent.keyDown(search,{key:"Enter",isComposing:true});expect(navigate).not.toHaveBeenCalled();
  fireEvent.change(search,{target:{value:"no match zzz"}});
  expect(screen.getAllByText("No matching pages, insights or session assets.").length).toBeGreaterThan(0);
  expect(search.getAttribute("aria-activedescendant")).toBeNull();
});
it("shows only owned assets and retains recent selection across close/reopen",()=>{
  const props={scope,assets,close:()=>{},navigate:()=>{}};
  const view=render(<CommandPalette open {...props}/>);
  const input=screen.getByRole("combobox");fireEvent.change(input,{target:{value:"history"}});fireEvent.keyDown(input,{key:"Enter"});
  fireEvent.change(input,{target:{value:""}});
  view.rerender(<CommandPalette open={false} {...props}/>);view.rerender(<CommandPalette open {...props}/>);
  expect(screen.getAllByRole("option")[0].textContent).toContain("History");
  fireEvent.change(input,{target:{value:"USD"}});expect(screen.getAllByRole("option").filter(o=>o.textContent?.includes("Session assets"))).toHaveLength(2);
  expect(screen.queryByText(/Public network/)).toBeNull();expect(screen.queryByText(/PRIVATE/)).toBeNull();
});
it("mounts from the trigger and clears query/modal on wallet or network switch",()=>{
  const view=render(<CommandTrigger/>);const trigger=screen.getByRole("button",{name:"Search routes and insights"});
  trigger.focus();fireEvent.click(trigger);fireEvent.change(screen.getByRole("combobox"),{target:{value:"privatequery"}});
  state.session={...state.session,chainId:2};view.rerender(<CommandTrigger/>);
  expect(screen.queryByRole("dialog")).toBeNull();fireEvent.click(screen.getByRole("button",{name:"Search routes and insights"}));
  expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("");
  state.session={...state.session,isConnected:false};view.rerender(<CommandTrigger/>);expect(screen.queryByRole("dialog")).toBeNull();
});
it("offers an instant scan first for a pasted contract and remembers it until cleared",()=>{
  const navigate=vi.fn(),address="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  render(<CommandPalette open scope={null} assets={[]} close={()=>{}} navigate={navigate}/>);
  const search=screen.getByRole("combobox");fireEvent.change(search,{target:{value:address}});
  expect(screen.getAllByRole("option")[0].textContent).toContain("Run AI Risk Scan");
  fireEvent.keyDown(search,{key:"Enter"});
  expect(navigate.mock.calls[0][0]).toMatch(new RegExp(`^/scan\\?query=${address}&chain=base&run=`));
  fireEvent.change(search,{target:{value:""}});
  expect(screen.getAllByRole("option")[0].textContent).toContain("Recent");
  act(()=>clearPaletteRecents());
  expect(screen.queryByText(/Recent ·/)).toBeNull();
});
it("wraps arrow navigation and records insight visits",()=>{
  const view=render(<CommandPalette open scope={null} assets={[]} close={()=>{}} navigate={()=>{}}/>);
  const search=screen.getByRole("combobox");fireEvent.keyDown(search,{key:"ArrowUp"});
  const options=screen.getAllByRole("option");expect(options[options.length-1].getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(search,{key:"ArrowDown"});expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe("true");
  view.unmount();state.pathname="/insights/proxy-inspector";render(<CommandTrigger/>);
  expect(readPaletteRecents().insights).toEqual(["proxy-inspector"]);state.pathname="/dashboard";
});
