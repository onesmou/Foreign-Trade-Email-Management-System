package com.rehabintl.crm;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.InterruptedIOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Signed online client. All application data and AI credentials stay on the CRM server. */
public final class MainActivity extends Activity {
    private static final int CHOOSE_UPLOAD = 100, SAVE_FILE = 101;
    private static final int INK = Color.rgb(30, 61, 49), GREEN = Color.rgb(28, 117, 91);
    private final NavigationPolicy policy = new NavigationPolicy(BuildConfig.CRM_URL);
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final AtomicBoolean downloadBusy = new AtomicBoolean(false);
    private WebView browser;
    private FrameLayout stage;
    private LinearLayout errorPanel;
    private TextView errorTitle, errorText, connectionLabel;
    private ProgressBar progress;
    private boolean failed, rendererGone;
    private ValueCallback<Uri[]> uploadCallback;
    private Download pendingDownload;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if(Build.VERSION.SDK_INT>=30){
            getWindow().setDecorFitsSystemWindows(false);
            android.view.WindowInsetsController bars=getWindow().getInsetsController();
            if(bars!=null)bars.setSystemBarsAppearance(android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.WHITE);
        setContentView(root);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int left, top, right, bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                left=bars.left; top=bars.top; right=bars.right; bottom=Math.max(bars.bottom, keyboard.bottom);
            } else {
                left=insets.getSystemWindowInsetLeft(); top=insets.getSystemWindowInsetTop();
                right=insets.getSystemWindowInsetRight(); bottom=insets.getSystemWindowInsetBottom();
            }
            view.setPadding(left, top, right, bottom); return insets;
        });
        root.requestApplyInsets();
        LinearLayout toolbar = new LinearLayout(this); toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setBackgroundColor(Color.rgb(245,249,246));
        root.addView(toolbar,new LinearLayout.LayoutParams(-1,dp(50)));
        Button back=button("返回",this::goBack); toolbar.addView(back);
        LinearLayout title=new LinearLayout(this); title.setOrientation(LinearLayout.VERTICAL);
        toolbar.addView(title,new LinearLayout.LayoutParams(0,-2,1));
        TextView name=text("RehabIntl CRM",14); name.setTypeface(null,android.graphics.Typeface.BOLD); title.addView(name);
        connectionLabel=text("wmcrm.jbenlz.com",10); connectionLabel.setSingleLine(true);
        connectionLabel.setEllipsize(TextUtils.TruncateAt.END); title.addView(connectionLabel);
        toolbar.addView(button("刷新",()->confirmReload(false)));
        Button more=button("更多",()->{}); more.setOnClickListener(v->menu(more)); toolbar.addView(more);
        progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100); root.addView(progress,new LinearLayout.LayoutParams(-1,dp(2)));
        stage=new FrameLayout(this); root.addView(stage,new LinearLayout.LayoutParams(-1,0,1));
        createErrorPanel();
        try {
            browser=new WebView(this); stage.addView(browser,0,new FrameLayout.LayoutParams(-1,-1));
            configureBrowser();
            if(state==null || browser.restoreState(state)==null || !policy.trusted(browser.getUrl())) browser.loadUrl(BuildConfig.CRM_URL);
        } catch(RuntimeException e) {
            showError("手机网页组件暂不可用","请在手机系统中更新 Android System WebView 或 Chrome 后重试；客户数据没有删除。也可以暂时通过浏览器使用 CRM。");
        }
        if(Build.VERSION.SDK_INT>=33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::goBack);
    }
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private TextView text(String value,int size){TextView view=new TextView(this);view.setText(value);view.setTextColor(INK);view.setTextSize(size);return view;}
    private Button button(String name,Runnable action){Button view=new Button(this);view.setText(name);view.setTextColor(GREEN);view.setTextSize(12);view.setAllCaps(false);view.setMinWidth(0);view.setMinimumWidth(0);view.setPadding(dp(9),0,dp(9),0);view.setOnClickListener(v->action.run());return view;}
    private void createErrorPanel(){
        errorPanel=new LinearLayout(this);errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);errorPanel.setPadding(dp(28),dp(24),dp(28),dp(24));
        errorPanel.setBackgroundColor(Color.rgb(245,248,246));
        errorTitle=text("正在连接 CRM",22);errorTitle.setTypeface(null,android.graphics.Typeface.BOLD);errorTitle.setGravity(Gravity.CENTER);errorPanel.addView(errorTitle);
        TextView host=text(BuildConfig.CRM_URL,12);host.setPadding(0,dp(12),0,dp(14));host.setGravity(Gravity.CENTER);errorPanel.addView(host);
        errorText=text("",14);errorText.setGravity(Gravity.CENTER);errorText.setLineSpacing(dp(5),1);errorPanel.addView(errorText);
        Button retry=button("重新连接",this::reload);LinearLayout.LayoutParams gap=new LinearLayout.LayoutParams(-2,dp(48));gap.topMargin=dp(22);errorPanel.addView(retry,gap);
        errorPanel.addView(button("在浏览器中检查",()->openExternal(BuildConfig.CRM_URL)));
        errorPanel.setVisibility(View.GONE);stage.addView(errorPanel,new FrameLayout.LayoutParams(-1,-1));
    }
    private void showError(String title,String message){
        failed=true;if(browser!=null&&!rendererGone)browser.setVisibility(View.INVISIBLE);
        progress.setVisibility(View.INVISIBLE);errorTitle.setText(title);errorText.setText(message);
        errorPanel.setVisibility(View.VISIBLE);connectionLabel.setText("安全连接尚未建立");
    }
    private void reload(){if(browser==null||rendererGone){recreate();return;}browser.loadUrl(policy.trusted(browser.getUrl())?browser.getUrl():BuildConfig.CRM_URL);}
    private void confirmReload(boolean home){
        Runnable action=()->{if(home&&browser!=null&&!rendererGone)browser.loadUrl(BuildConfig.CRM_URL);else reload();};
        if(failed){action.run();return;}
        new AlertDialog.Builder(this).setTitle(home?"回到工作台？":"重新载入页面？").setMessage("未提交的文字和正在生成的内容可能中断。已保存到服务器的资料不会删除。").setNegativeButton("继续当前操作",null).setPositiveButton("确认继续",(dialog,which)->action.run()).show();
    }
    private void goBack(){if(browser!=null&&!rendererGone&&!failed&&browser.canGoBack())browser.goBack();else moveTaskToBack(true);}
    // API 33+ uses the platform OnBackInvokedDispatcher registered in onCreate.
    // This deprecated override is exclusively the Android 8-12 fallback, not the gesture handler.
    @android.annotation.SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed(){goBack();}
    private void menu(View anchor){
        PopupMenu menu=new PopupMenu(this,anchor);
        menu.getMenu().add("回到工作台").setOnMenuItemClickListener(item->{confirmReload(true);return true;});
        menu.getMenu().add("在浏览器打开").setOnMenuItemClickListener(item->{openExternal(BuildConfig.CRM_URL);return true;});
        menu.getMenu().add("连接与版本信息").setOnMenuItemClickListener(item->{new AlertDialog.Builder(this).setTitle("RehabIntl CRM "+BuildConfig.VERSION_NAME).setMessage("服务器："+BuildConfig.CRM_URL+"\n\n这是联网客户端，复用线上账号与权限。API 密钥不存入安装包。请在 CRM 的‘我的账号’中退出或切换账号。\n\n文件下载时请保持 App 在前台。首版不含离线资料、后台消息推送和直接拍照上传。").setPositiveButton("知道了",null).show();return true;});
        menu.show();
    }
    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    @SuppressWarnings("deprecation")
    private void configureBrowser(){
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings=browser.getSettings();
        settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);settings.setGeolocationEnabled(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);settings.setUseWideViewPort(true);settings.setLoadWithOverviewMode(true);
        settings.setUserAgentString(settings.getUserAgentString()+" RehabIntlCRM/"+BuildConfig.VERSION_NAME);
        browser.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(browser,false);
        browser.setWebViewClient(new WebViewClient(){
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap favicon){
                failed=false;errorPanel.setVisibility(View.GONE);view.setVisibility(View.VISIBLE);progress.setVisibility(View.VISIBLE);connectionLabel.setText(R.string.connecting_status);
            }
            @Override public void onPageFinished(WebView view,String url){
                if(!failed&&policy.trusted(url)){progress.setVisibility(View.INVISIBLE);connectionLabel.setText(R.string.connected_status);CookieManager.getInstance().flush();}
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                String url=request.getUrl().toString();
                if(policy.trusted(url)){
                    if(request.isForMainFrame()&&policy.downloadable(url)){prepareDownload(url,null,null,null);return true;}
                    return false;
                }
                if(request.isForMainFrame()&&request.hasGesture()&&policy.external(url))confirmExternal(url);
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                String raw=request.getUrl().getScheme(),scheme=raw==null?"":raw.toLowerCase(java.util.Locale.ROOT),url=request.getUrl().toString();
                if("http".equals(scheme)||"file".equals(scheme)||"content".equals(scheme)||("https".equals(scheme)&&!policy.trusted(url)))
                    return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
                return null;
            }
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error){
                handler.cancel();
                showError("服务器证书校验失败","当前证书与域名不匹配、已过期或不受信任。为保护账号和客户资料，App 已停止连接。\n\n请在宝塔为 wmcrm.jbenlz.com 配置有效的 HTTPS 证书后重试，不要关闭证书验证。");
            }
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){
                if(request.isForMainFrame()&&!failed)showError("暂时无法连接 CRM","请检查 Wi-Fi / 移动网络和服务器运行状态。也请确认手机能通过浏览器访问以上 HTTPS 网址，然后重试。");
            }
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){
                if(request.isForMainFrame()&&response.getStatusCode()>=400)showError("服务器暂未正常响应","HTTP "+response.getStatusCode()+"。请检查宝塔中的 CRM 容器和反向代理是否正常，稍后重试。");
            }
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){
                rendererGone=true;stage.removeView(view);view.destroy();showError("网页组件已停止","手机可能正在回收内存。请重新连接；已保存在服务器上的资料不受影响。");return true;
            }
        });
        browser.setWebChromeClient(new WebChromeClient(){
            @Override public void onProgressChanged(WebView view,int value){if(!failed)progress.setProgress(value);}
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(uploadCallback!=null)uploadCallback.onReceiveValue(null);
                if(!policy.trusted(view.getUrl())){callback.onReceiveValue(null);return true;}
                uploadCallback=callback;
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");
                ArrayList<String> mimes=new ArrayList<>();
                for(String accepted:params.getAcceptTypes())for(String part:accepted.split(",")){
                    String type=part.trim();
                    if(type.startsWith("."))type=android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(type.substring(1).toLowerCase(java.util.Locale.ROOT));
                    if(type!=null&&type.contains("/"))mimes.add(type);
                }
                if(!mimes.isEmpty())intent.putExtra(Intent.EXTRA_MIME_TYPES,mimes.toArray(new String[0]));
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);
                try{startActivityForResult(intent,CHOOSE_UPLOAD);}catch(ActivityNotFoundException e){uploadCallback.onReceiveValue(null);uploadCallback=null;toast("没有找到系统文件选择器，请先安装或启用文件管理应用");}
                return true;
            }
        });
        browser.setDownloadListener((url,userAgent,disposition,mime,length)->prepareDownload(url,userAgent,disposition,mime));
    }
    private void confirmExternal(String url){new AlertDialog.Builder(this).setTitle("在其他应用中打开？").setMessage(url).setNegativeButton("留在 CRM",null).setPositiveButton("继续打开",(dialog,which)->openExternal(url)).show();}
    private void openExternal(String url){
        if(!policy.external(url))return;
        try{Uri uri=Uri.parse(url);String action="tel".equals(uri.getScheme())?Intent.ACTION_DIAL:"mailto".equals(uri.getScheme())?Intent.ACTION_SENDTO:Intent.ACTION_VIEW;Intent intent=new Intent(action,uri);if(Intent.ACTION_VIEW.equals(action))intent.addCategory(Intent.CATEGORY_BROWSABLE);startActivity(intent);}
        catch(ActivityNotFoundException e){toast("手机没有能打开此链接的应用");}
    }
    private static final class Download {
        final String url,cookie,userAgent;String mime,name;
        Download(String url,String cookie,String userAgent){this.url=url;this.cookie=cookie;this.userAgent=userAgent;}
    }
    private void prepareDownload(String url,String userAgent,String disposition,String mime){
        if(!policy.downloadable(url)){toast("此链接不能在 App 内下载，请使用 CRM 中的原文件下载按钮");return;}
        if(pendingDownload!=null||downloadBusy.get()){toast("请先完成当前文件的保存");return;}
        Download item=new Download(url,CookieManager.getInstance().getCookie(url),userAgent==null?browser.getSettings().getUserAgentString():userAgent);
        pendingDownload=item;
        network.execute(()->{
            HttpURLConnection connection=null;
            try{
                String type=mime,header=disposition;
                if(type==null||header==null){connection=connect(item,"HEAD");type=connection.getContentType();header=connection.getHeaderField("Content-Disposition");}
                item.mime=type==null?"application/octet-stream":type.split(";")[0];
                item.name=NavigationPolicy.filename(header,"CRM-file");
                runOnUiThread(()->{if(isFinishing()||isDestroyed())return;Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(item.mime).putExtra(Intent.EXTRA_TITLE,item.name);try{startActivityForResult(intent,SAVE_FILE);}catch(ActivityNotFoundException e){pendingDownload=null;toast("找不到系统文件保存器");}});
            }catch(Exception e){runOnUiThread(()->{pendingDownload=null;toast("无法准备下载，请检查登录状态、网络及 HTTPS 证书");});}
            finally{if(connection!=null)connection.disconnect();}
        });
    }
    private HttpURLConnection connect(Download item,String method)throws Exception{
        String current=item.url;
        for(int i=0;i<4;i++){
            if(!policy.downloadable(current))throw new SecurityException("Download origin rejected");
            HttpURLConnection connection=(HttpURLConnection)new URL(current).openConnection();
            connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);connection.setConnectTimeout(15000);connection.setReadTimeout(60000);connection.setRequestMethod(method);
            if(item.cookie!=null)connection.setRequestProperty("Cookie",item.cookie);
            connection.setRequestProperty("User-Agent",item.userAgent);
            int status=connection.getResponseCode();
            if(status>=300&&status<400){String location=connection.getHeaderField("Location");String next=location==null?"":new URL(new URL(current),location).toString();connection.disconnect();current=next;continue;}
            if(status!=200){connection.disconnect();throw new java.io.IOException("Download unavailable");}
            return connection;
        }
        throw new java.io.IOException("Too many redirects");
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==CHOOSE_UPLOAD&&uploadCallback!=null){
            ArrayList<Uri> files=new ArrayList<>();
            if(result==RESULT_OK&&data!=null){ClipData clip=data.getClipData();if(clip!=null){for(int i=0;i<clip.getItemCount()&&i<50;i++){Uri uri=clip.getItemAt(i).getUri();if("content".equals(uri.getScheme()))files.add(uri);}}else if(data.getData()!=null&&"content".equals(data.getData().getScheme()))files.add(data.getData());}
            uploadCallback.onReceiveValue(files.isEmpty()?null:files.toArray(new Uri[0]));uploadCallback=null;
        }
        if(request==SAVE_FILE){Download item=pendingDownload;pendingDownload=null;if(result==RESULT_OK&&data!=null&&item!=null&&data.getData()!=null&&"content".equals(data.getData().getScheme()))saveDownload(item,data.getData());}
    }
    private void saveDownload(Download item,Uri destination){
        downloadBusy.set(true);toast("正在保存文件，请保持 App 在前台");
        network.execute(()->{
            HttpURLConnection connection=null;
            try{
                connection=connect(item,"GET");
                long expected=connection.getContentLengthLong(),written=0;
                try(InputStream input=connection.getInputStream();OutputStream output=getContentResolver().openOutputStream(destination,"w")){
                    if(output==null)throw new java.io.IOException("No output destination");
                    byte[] buffer=new byte[32768];int count;
                    while((count=input.read(buffer))!=-1){if(Thread.currentThread().isInterrupted())throw new InterruptedIOException();output.write(buffer,0,count);written+=count;}
                }
                if(expected>=0&&written!=expected)throw new java.io.IOException("Incomplete download");
                runOnUiThread(()->{if(isFinishing()||isDestroyed())return;new AlertDialog.Builder(this).setTitle("文件已保存").setMessage(item.name).setNegativeButton("完成",null).setPositiveButton("打开文件",(dialog,which)->{try{startActivity(Intent.createChooser(new Intent(Intent.ACTION_VIEW).setDataAndType(destination,item.mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),"选择打开方式"));}catch(ActivityNotFoundException e){toast("请从手机文件管理中打开文件");}}).show();});
            }catch(Exception e){try{DocumentsContract.deleteDocument(getContentResolver(),destination);}catch(Exception ignored){}runOnUiThread(()->toast("下载未完成，已尝试清理不完整文件。请检查网络或重新登录后重试"));}
            finally{if(connection!=null)connection.disconnect();downloadBusy.set(false);}
        });
    }
    private void toast(String message){if(!isDestroyed())Toast.makeText(this,message,Toast.LENGTH_LONG).show();}
    @Override protected void onSaveInstanceState(Bundle state){if(browser!=null&&!rendererGone)browser.saveState(state);super.onSaveInstanceState(state);}
    @Override protected void onPause(){if(browser!=null&&!rendererGone){browser.onPause();CookieManager.getInstance().flush();}super.onPause();}
    @Override protected void onResume(){super.onResume();if(browser!=null&&!rendererGone)browser.onResume();}
    @Override protected void onDestroy(){
        if(uploadCallback!=null){uploadCallback.onReceiveValue(null);uploadCallback=null;}
        network.shutdownNow();
        if(browser!=null&&!rendererGone){stage.removeView(browser);browser.destroy();}
        super.onDestroy();
    }
}
